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

/** 待确认的人员变更：三种都会给当事人发 PROJECT_STAFF 通知，共用同一张确认卡片 */
type PendingStaffAction = {
  kind: "add" | "role" | "remove";
  userId: string;
  name: string;
  summary: string;
  confirmText: string;
  role?: ProjectStaffRole;
  projectStaffId?: string;
};

Page({
  data: {
    projectId: "",
    loading: true,
    loadError: "",
    staff: [] as StaffRow[],
    // 加人 / 改角色 / 移出原本都是 ActionSheet 点完直接生效，挂不住发送前提示；
    // 三者都会给当事人发 PROJECT_STAFF 通知，所以统一先落到待确认卡片，
    // 看清会怎么提醒（并可关通道 / 本次不提醒）再确认。
    pendingAction: null as PendingStaffAction | null,
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
  /**
   * 可选的项目角色由候选人的平台角色决定，与服务端 assertRoleMatches 同口径：
   * 平台管理员两种都行，其余人只能选与自身平台角色一致的那种。
   * 全都列出来的话，不匹配的组合提交必然吃 PROJECT_STAFF_ROLE_MISMATCH ——
   * 等于把注定失败的操作摆在常用入口上（Web 端本就按平台角色限制了）。
   */
  allowedProjectRoles(platformRole: string): ProjectStaffRole[] {
    if (platformRole === "PLATFORM_ADMIN") {
      return ["PROJECT_MANAGER", "TECHNICIAN"];
    }
    return platformRole === "PROJECT_MANAGER"
      ? ["PROJECT_MANAGER"]
      : ["TECHNICIAN"];
  },
  pickRoleThenAdd(candidate: StaffCandidate) {
    const roles = this.allowedProjectRoles(candidate.platformRole);
    if (roles.length === 1) {
      // 只有一种合法角色，不必再弹一层选择
      this.stageAdd(candidate, roles[0]!);
      return;
    }
    wx.showActionSheet({
      itemList: roles.map((role) => `加为${ROLE_LABELS[role]}`),
      success: (res) => {
        const role = roles[res.tapIndex];
        if (role) this.stageAdd(candidate, role);
      },
    });
  },
  stageAdd(candidate: StaffCandidate, role: ProjectStaffRole) {
    this.stage({
      kind: "add",
      userId: candidate.id,
      name: candidate.name,
      summary: `即将把「${candidate.name}」加为${ROLE_LABELS[role]}`,
      confirmText: "确认添加",
      role,
    });
  },
  stage(pendingAction: PendingStaffAction) {
    this.setData({
      pendingAction,
      deliveryScene: {
        scene: "PROJECT_STAFF",
        projectId: this.data.projectId,
        targetUserId: pendingAction.userId,
      },
      deliveryOverride: {},
    });
    // 确认卡片在列表上方：从下面的成员行触发时不滚上去就看不见
    wx.pageScrollTo({ scrollTop: 0, duration: 200 });
  },
  onDeliveryChange(event: WechatMiniprogram.CustomEvent) {
    this.setData({
      deliveryOverride: (event.detail?.override ?? {}) as DeliveryOverride,
    });
  },
  onCancelPending() {
    this.clearPending();
  },
  clearPending() {
    this.setData({
      pendingAction: null,
      deliveryScene: null,
      deliveryOverride: {},
    });
  },
  onConfirmPending() {
    const pending = this.data.pendingAction;
    if (!pending || this.data.submitting) return;
    const override = this.data.deliveryOverride;
    // 覆盖是一次性的：只有真被改过才带上，空对象照旧走后台规则
    const withOverride =
      Object.keys(override).length > 0 ? override : undefined;
    this.setData({ submitting: true });
    const done = (title: string) => {
      wx.showToast({ title, icon: "success" });
      this.clearPending();
      void this.load();
    };
    const fail = (fallback: string) => (error: unknown) => {
      wx.showToast({
        title: error instanceof Error ? error.message : fallback,
        icon: "none",
      });
    };
    const task =
      pending.kind === "add"
        ? addProjectStaff(this.data.projectId, {
            userId: pending.userId,
            role: pending.role!,
            ...(withOverride ? { deliveryOverride: withOverride } : {}),
          })
            .then(() => done("已添加"))
            .catch(fail("添加失败"))
        : pending.kind === "role"
          ? updateProjectStaffRole(
              this.data.projectId,
              pending.projectStaffId!,
              pending.role!,
              withOverride,
            )
              .then(() => done("已更新"))
              .catch(fail("更新失败"))
          : removeProjectStaff(
              this.data.projectId,
              pending.projectStaffId!,
              withOverride,
            )
              .then(() => done("已移出"))
              .catch(fail("移出失败"));
    void task.then(() => this.setData({ submitting: false }));
  },
  onStaffActions(event: WechatMiniprogram.TouchEvent) {
    const id = event.currentTarget.dataset.id as string;
    const member = this.data.staff.find((row) => row.id === id);
    if (!member) return;
    const otherRole: ProjectStaffRole =
      member.role === "PROJECT_MANAGER" ? "TECHNICIAN" : "PROJECT_MANAGER";
    // 切到另一个项目角色未必合法：服务端 assertRoleMatches 要求与平台角色一致
    // （平台管理员除外）。不判的话这个选项对多数成员点了必然报错。
    const canSwitch = this.allowedProjectRoles(
      member.user.platformRole ?? "",
    ).includes(otherRole);
    const items = canSwitch
      ? [`改为${ROLE_LABELS[otherRole]}`, "移出项目"]
      : ["移出项目"];
    wx.showActionSheet({
      itemList: items,
      success: (res) => {
        const action = items[res.tapIndex];
        if (action === "移出项目") {
          this.stage({
            kind: "remove",
            userId: member.userId,
            name: member.user.name,
            summary: `即将把「${member.user.name}」移出本项目，其在本项目下的工单分配会一并解除`,
            confirmText: "确认移出",
            projectStaffId: member.id,
          });
        } else if (action) {
          this.stage({
            kind: "role",
            userId: member.userId,
            name: member.user.name,
            summary: `即将把「${member.user.name}」改为${ROLE_LABELS[otherRole]}`,
            confirmText: "确认调整",
            role: otherRole,
            projectStaffId: member.id,
          });
        }
      },
    });
  },
});
