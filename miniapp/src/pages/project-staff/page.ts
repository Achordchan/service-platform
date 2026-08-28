import { ensureLoggedIn } from "../../lib/auth";
import {
  listProjectStaff,
  listAssignableProjectStaff,
  addProjectStaff,
  updateProjectStaffRole,
  removeProjectStaff,
  type ProjectStaffMember,
  type StaffCandidate,
  type ProjectStaffRole,
} from "../../lib/api";
import type { DeliveryOverride } from "../../lib/delivery";

const ROLE_LABELS: Record<ProjectStaffRole, string> = {
  PROJECT_MANAGER: "项目经理",
  TECHNICIAN: "技术人员",
};

type StaffRow = ProjectStaffMember & { roleLabel: string };

Page({
  data: {
    projectId: "",
    loading: true,
    loadError: "",
    staff: [] as StaffRow[],
    // 加人原本是两级 ActionSheet 点完直接生效，挂不住发送前提示；
    // 选完人和角色先落到待确认卡片，看清会提醒谁再确认。
    pendingAdd: null as
      | { userId: string; name: string; role: ProjectStaffRole; roleLabel: string }
      | null,
    deliveryScene: null as unknown,
    deliveryOverride: {} as DeliveryOverride,
    // 候选（尚未加入本项目的内部人员）
    candidates: [] as StaffCandidate[],
    // 候选选择面板：原来用 wx.showActionSheet + slice(0,10)，两处都不成立 ——
    // itemList 上限是 6，超了直接调用失败；而候选接口最多回 500 人，
    // 排在后面的人永远选不到。改成带搜索的可滚动列表。
    pickerVisible: false,
    candidateKeyword: "",
    filteredCandidates: [] as StaffCandidate[],
    submitting: false,
  },
  onLoad(query: Record<string, string | undefined>) {
    this.setData({ projectId: query.projectId ?? "" });
  },
  onShow() {
    if (!ensureLoggedIn()) return;
    void this.load();
  },
  async load() {
    if (!this.data.projectId) {
      this.setData({ loading: false, loadError: "缺少项目参数" });
      return;
    }
    this.setData({ loading: true, loadError: "" });
    try {
      const [staff, assignable] = await Promise.all([
        listProjectStaff(this.data.projectId),
        listAssignableProjectStaff(this.data.projectId),
      ]);
      const existingIds = new Set(staff.map((member) => member.userId));
      this.setData({
        loading: false,
        staff: staff.map((member) => ({
          ...member,
          roleLabel: ROLE_LABELS[member.role] ?? member.role,
        })),
        candidates: assignable.filter(
          (candidate) => !existingIds.has(candidate.id),
        ),
      });
    } catch (error) {
      const denied =
        error instanceof Error &&
        (error as { status?: number }).status === 403;
      this.setData({
        loading: false,
        loadError: denied
          ? "当前账号无权管理该项目的人员"
          : error instanceof Error
            ? error.message
            : "加载失败",
      });
    }
  },
  onAddStaff() {
    if (this.data.candidates.length === 0) {
      wx.showToast({ title: "没有可添加的人员", icon: "none" });
      return;
    }
    this.setData({
      pickerVisible: true,
      candidateKeyword: "",
      filteredCandidates: this.data.candidates,
    });
  },
  /** 面板内不穿透到遮罩 / 不滚穿底层列表 */
  noop() {},
  onClosePicker() {
    this.setData({ pickerVisible: false, candidateKeyword: "" });
  },
  onCandidateSearch(event: WechatMiniprogram.Input) {
    const keyword = event.detail.value.trim().toLowerCase();
    this.setData({
      candidateKeyword: event.detail.value,
      filteredCandidates: keyword
        ? this.data.candidates.filter(
            (candidate) =>
              candidate.name.toLowerCase().includes(keyword) ||
              candidate.email.toLowerCase().includes(keyword),
          )
        : this.data.candidates,
    });
  },
  onPickCandidate(event: WechatMiniprogram.TouchEvent) {
    const userId = event.currentTarget.dataset.id as string;
    const candidate = this.data.candidates.find((item) => item.id === userId);
    if (!candidate) return;
    this.setData({ pickerVisible: false, candidateKeyword: "" });
    this.pickRoleThenAdd(candidate);
  },
  pickRoleThenAdd(candidate: StaffCandidate) {
    wx.showActionSheet({
      itemList: ["加为项目经理", "加为技术人员"],
      success: (res) => {
        const role: ProjectStaffRole =
          res.tapIndex === 0 ? "PROJECT_MANAGER" : "TECHNICIAN";
        this.setData({
          pendingAdd: {
            userId: candidate.id,
            name: candidate.name,
            role,
            roleLabel: ROLE_LABELS[role],
          },
          deliveryScene: {
            scene: "PROJECT_STAFF",
            projectId: this.data.projectId,
            targetUserId: candidate.id,
          },
          deliveryOverride: {},
        });
      },
    });
  },
  onDeliveryChange(event: WechatMiniprogram.CustomEvent) {
    this.setData({
      deliveryOverride: (event.detail?.override ?? {}) as DeliveryOverride,
    });
  },
  onCancelAdd() {
    this.setData({
      pendingAdd: null,
      deliveryScene: null,
      deliveryOverride: {},
    });
  },
  onConfirmAdd() {
    const pending = this.data.pendingAdd;
    if (!pending) return;
    this.submitAdd(pending.userId, pending.role);
  },
  submitAdd(userId: string, role: ProjectStaffRole) {
    if (this.data.submitting) return;
    this.setData({ submitting: true });
    const override = this.data.deliveryOverride;
    addProjectStaff(this.data.projectId, {
      userId,
      role,
      ...(Object.keys(override).length > 0
        ? { deliveryOverride: override }
        : {}),
    })
      .then(() => {
        wx.showToast({ title: "已添加", icon: "success" });
        // 覆盖是一次性的，不跨下一次添加沿用
        this.setData({
          pendingAdd: null,
          deliveryScene: null,
          deliveryOverride: {},
        });
        void this.load();
      })
      .catch((error: unknown) => {
        wx.showToast({
          title: error instanceof Error ? error.message : "添加失败",
          icon: "none",
        });
      })
      .then(() => this.setData({ submitting: false }));
  },
  onStaffActions(event: WechatMiniprogram.TouchEvent) {
    const id = event.currentTarget.dataset.id as string;
    const member = this.data.staff.find((row) => row.id === id);
    if (!member) return;
    const otherRole: ProjectStaffRole =
      member.role === "PROJECT_MANAGER" ? "TECHNICIAN" : "PROJECT_MANAGER";
    wx.showActionSheet({
      itemList: [`改为${ROLE_LABELS[otherRole]}`, "移出项目"],
      success: (res) => {
        if (res.tapIndex === 0) this.changeRole(member.id, otherRole);
        else if (res.tapIndex === 1)
          this.confirmRemove(member.id, member.user.name);
      },
    });
  },
  changeRole(projectStaffId: string, role: ProjectStaffRole) {
    updateProjectStaffRole(this.data.projectId, projectStaffId, role)
      .then(() => {
        wx.showToast({ title: "已更新", icon: "success" });
        void this.load();
      })
      .catch((error: unknown) => {
        wx.showToast({
          title: error instanceof Error ? error.message : "更新失败",
          icon: "none",
        });
      });
  },
  confirmRemove(projectStaffId: string, name: string) {
    wx.showModal({
      title: "移出项目",
      content: `确定将「${name}」移出本项目吗？`,
      confirmText: "移出",
      confirmColor: "#d14343",
      success: (res) => {
        if (!res.confirm) return;
        void removeProjectStaff(this.data.projectId, projectStaffId)
          .then(() => {
            wx.showToast({ title: "已移出", icon: "success" });
            void this.load();
          })
          .catch((error: unknown) => {
            wx.showToast({
              title: error instanceof Error ? error.message : "移出失败",
              icon: "none",
            });
          });
      },
    });
  },
});
