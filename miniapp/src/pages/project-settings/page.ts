import { ensureLoggedIn } from "../../lib/auth";
import {
  getProject,
  updateProjectSettings,
  type ProjectSettingsInput,
} from "../../lib/api";
import {
  htmlToText,
  PROJECT_STATUS_LABELS,
  type ProjectStatusValue,
} from "../../lib/format";

const STATUS_OPTIONS: Array<{ value: ProjectStatusValue; label: string }> = [
  { value: "DRAFT", label: PROJECT_STATUS_LABELS.DRAFT },
  { value: "ACTIVE", label: PROJECT_STATUS_LABELS.ACTIVE },
  { value: "PAUSED", label: PROJECT_STATUS_LABELS.PAUSED },
  { value: "COMPLETED", label: PROJECT_STATUS_LABELS.COMPLETED },
  { value: "EXPIRED", label: PROJECT_STATUS_LABELS.EXPIRED },
];

function toIso(date: string): string | null {
  return date ? `${date}T00:00:00.000Z` : null;
}

Page({
  data: {
    projectId: "",
    loading: true,
    loadError: "",
    title: "",
    descText: "",
    statusOptions: STATUS_OPTIONS,
    statusIndex: 1,
    // 草稿（外部接入待激活）的状态由接入流程管理，updateProject 明确拒绝提交
    // status: "DRAFT"，回传就会让标题/日期/展示开关等任何修改一起失败。对齐 Web：
    // 草稿态锁死状态选择器，提交时也不带 status
    statusLocked: false,
    startDate: "",
    endDate: "",
    showMilestones: true,
    showProgress: true,
    customerUpdatesEnabled: true,
    customerRequestsEnabled: true,
    customerFilesEnabled: true,
    submitting: false,
  },
  onLoad(query: Record<string, string | undefined>) {
    this.setData({ projectId: query.projectId ?? "" });
  },
  onShow() {
    if (!ensureLoggedIn()) return;
    if (this.data.loading) void this.load();
  },
  async load() {
    if (!this.data.projectId) {
      this.setData({ loading: false, loadError: "缺少项目参数" });
      return;
    }
    try {
      const project = await getProject(this.data.projectId);
      const statusIndex = STATUS_OPTIONS.findIndex(
        (option) => option.value === project.status,
      );
      this.setData({
        loading: false,
        title: project.title,
        descText: project.description ? htmlToText(project.description) : "",
        statusIndex: statusIndex >= 0 ? statusIndex : 1,
        statusLocked: project.status === "DRAFT",
        startDate: project.startDate ? project.startDate.slice(0, 10) : "",
        endDate: project.endDate ? project.endDate.slice(0, 10) : "",
        showMilestones: project.showMilestones !== false,
        showProgress: project.showProgress !== false,
        customerUpdatesEnabled: project.customerUpdatesEnabled !== false,
        customerRequestsEnabled: project.customerRequestsEnabled !== false,
        customerFilesEnabled: project.customerFilesEnabled !== false,
      });
      wx.setNavigationBarTitle({ title: "项目设置" });
    } catch (error) {
      this.setData({
        loading: false,
        loadError: error instanceof Error ? error.message : "加载失败",
      });
    }
  },
  onTitleInput(event: WechatMiniprogram.Input) {
    this.setData({ title: event.detail.value });
  },
  onDescInput(event: WechatMiniprogram.TextareaInput) {
    this.setData({ descText: event.detail.value });
  },
  onStatusChange(event: WechatMiniprogram.PickerChange) {
    this.setData({ statusIndex: Number(event.detail.value) });
  },
  onStartDateChange(event: WechatMiniprogram.PickerChange) {
    this.setData({ startDate: event.detail.value as string });
  },
  onEndDateChange(event: WechatMiniprogram.PickerChange) {
    this.setData({ endDate: event.detail.value as string });
  },
  onClearStart() {
    this.setData({ startDate: "" });
  },
  onClearEnd() {
    this.setData({ endDate: "" });
  },
  onToggle(event: WechatMiniprogram.SwitchChange) {
    const key = event.currentTarget.dataset.key as string;
    this.setData({ [key]: event.detail.value });
  },
  async onSubmit() {
    if (this.data.submitting) return;
    const title = this.data.title.trim();
    if (!title) {
      wx.showToast({ title: "请填写项目标题", icon: "none" });
      return;
    }
    if (
      this.data.startDate &&
      this.data.endDate &&
      this.data.endDate < this.data.startDate
    ) {
      wx.showToast({ title: "结束日期不能早于开始日期", icon: "none" });
      return;
    }
    const payload: ProjectSettingsInput = {
      title,
      // 草稿态不回传 status（服务端拒绝 DRAFT，带上会让整次保存失败）
      ...(this.data.statusLocked
        ? {}
        : { status: STATUS_OPTIONS[this.data.statusIndex]?.value }),
      description: this.data.descText.trim() || null,
      startDate: toIso(this.data.startDate),
      endDate: toIso(this.data.endDate),
      showMilestones: this.data.showMilestones,
      showProgress: this.data.showProgress,
      customerUpdatesEnabled: this.data.customerUpdatesEnabled,
      customerRequestsEnabled: this.data.customerRequestsEnabled,
      customerFilesEnabled: this.data.customerFilesEnabled,
    };
    this.setData({ submitting: true });
    try {
      await updateProjectSettings(this.data.projectId, payload);
      wx.showToast({ title: "已保存", icon: "success" });
      setTimeout(() => wx.navigateBack(), 600);
    } catch (error) {
      wx.showToast({
        title: error instanceof Error ? error.message : "保存失败，请重试",
        icon: "none",
      });
    } finally {
      this.setData({ submitting: false });
    }
  },
});
