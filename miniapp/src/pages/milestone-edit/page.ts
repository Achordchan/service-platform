import { ensureLoggedIn } from "../../lib/auth";
import {
  createMilestone,
  editMilestone,
  listMilestones,
  type MilestoneStatus,
  uploadAttachment,
} from "../../lib/api";
import type { DeliveryOverride } from "../../lib/delivery";
import { pickAttachments, type PickedFile } from "../../lib/pick-files";
import {
  escapeHtml,
  htmlToText,
  MILESTONE_STATUS_LABELS,
  type MilestoneStatusValue,
} from "../../lib/format";

const STATUS_OPTIONS: Array<{ value: MilestoneStatus; label: string }> = [
  { value: "NOT_STARTED", label: MILESTONE_STATUS_LABELS.NOT_STARTED },
  { value: "IN_PROGRESS", label: MILESTONE_STATUS_LABELS.IN_PROGRESS },
  { value: "COMPLETED", label: MILESTONE_STATUS_LABELS.COMPLETED },
];

function textToHtml(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((para) => para.trim())
    .filter(Boolean)
    .map((para) => `<p>${escapeHtml(para).replace(/\n/g, "<br/>")}</p>`)
    .join("");
}

/** YYYY-MM-DD → ISO（UTC 零点，匹配后端 z.iso.datetime 与全站 UTC 墙钟约定） */
function toIso(date: string): string | null {
  return date ? `${date}T00:00:00.000Z` : null;
}

Page({
  data: {
    projectId: "",
    milestoneId: "",
    mode: "create" as "create" | "edit",
    title: "",
    descText: "",
    statusOptions: STATUS_OPTIONS,
    statusIndex: 0,
    startDate: "",
    endDate: "",
    submitting: false,
    // 附件：与工单同一套两段式 —— 先建实体、再带 id 上传
    files: [] as PickedFile[],
    loading: false,
    loadError: "",
    // 本次提交的提醒方式覆盖（由 delivery-notice 组件回传）
    deliveryOverride: {} as DeliveryOverride,
    deliveryScene: null as unknown,
  },
  onLoad(query: Record<string, string | undefined>) {
    const projectId = query.projectId ?? "";
    const milestoneId = query.milestoneId ?? "";
    const mode: "create" | "edit" = milestoneId ? "edit" : "create";
    this.setData({
      projectId,
      milestoneId,
      mode,
      deliveryScene: { scene: "PROJECT_MILESTONE", projectId },
    });
    wx.setNavigationBarTitle({
      title: mode === "edit" ? "编辑里程碑" : "新增里程碑",
    });
    if (mode === "edit") void this.loadExisting();
  },
  onShow() {
    ensureLoggedIn();
  },
  async loadExisting() {
    this.setData({ loading: true, loadError: "" });
    try {
      const result = await listMilestones(this.data.projectId);
      const milestone = result.milestones.find(
        (item) => item.id === this.data.milestoneId,
      );
      if (!milestone) {
        this.setData({ loading: false, loadError: "里程碑不存在或已被删除" });
        return;
      }
      const statusIndex = STATUS_OPTIONS.findIndex(
        (option) => option.value === milestone.status,
      );
      this.setData({
        loading: false,
        title: milestone.title,
        descText: milestone.description ? htmlToText(milestone.description) : "",
        statusIndex: statusIndex >= 0 ? statusIndex : 0,
        startDate: milestone.startDate ? milestone.startDate.slice(0, 10) : "",
        endDate: milestone.endDate ? milestone.endDate.slice(0, 10) : "",
      });
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
  onDeliveryChange(event: WechatMiniprogram.CustomEvent) {
    this.setData({
      deliveryOverride: (event.detail?.override ?? {}) as DeliveryOverride,
    });
  },
  async onAddFile() {
    if (this.data.files.length >= 5) {
      wx.showToast({ title: "最多 5 个附件", icon: "none" });
      return;
    }
    const chosen = await pickAttachments(5 - this.data.files.length);
    if (chosen.length === 0) return;
    this.setData({ files: [...this.data.files, ...chosen] });
  },
  onRemoveFile(event: WechatMiniprogram.TouchEvent) {
    const index = Number(event.currentTarget.dataset.index);
    this.setData({
      files: this.data.files.filter((_, i) => i !== index),
    });
  },
  /** 实体建好后再传附件：服务端据此绑定归属并派生可见性 */
  async uploadPendingFiles(target: { projectUpdateId?: string; milestoneId?: string }) {
    let failed = 0;
    for (const file of this.data.files) {
      try {
        await uploadAttachment({
          filePath: file.localPath,
          fileName: file.fileName,
          projectId: this.data.projectId,
          ...target,
        });
      } catch {
        failed += 1;
      }
    }
    if (failed > 0) {
      wx.showToast({ title: `${failed} 个附件上传失败`, icon: "none" });
    }
  },
  async onSubmit() {
    if (this.data.submitting) return;
    const title = this.data.title.trim();
    if (!title) {
      wx.showToast({ title: "请填写里程碑标题", icon: "none" });
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
    const status = STATUS_OPTIONS[this.data.statusIndex]?.value ?? "NOT_STARTED";
    const descText = this.data.descText.trim();
    const payload = {
      title,
      description: descText ? textToHtml(descText) : null,
      status,
      startDate: toIso(this.data.startDate),
      endDate: toIso(this.data.endDate),
    };
    const override = this.data.deliveryOverride;
    const withOverride = {
      ...payload,
      ...(Object.keys(override).length > 0
        ? { deliveryOverride: override }
        : {}),
    };
    this.setData({ submitting: true });
    try {
      if (this.data.mode === "edit") {
        await editMilestone(
          this.data.projectId,
          this.data.milestoneId,
          withOverride,
        );
        await this.uploadPendingFiles({ milestoneId: this.data.milestoneId });
        wx.showToast({ title: "已保存", icon: "success" });
      } else {
        const created = await createMilestone(this.data.projectId, withOverride);
        await this.uploadPendingFiles({ milestoneId: created.id });
        wx.showToast({ title: "已新增", icon: "success" });
      }
      setTimeout(() => wx.navigateBack(), 600);
    } catch (error) {
      wx.showToast({
        title: error instanceof Error ? error.message : "提交失败，请重试",
        icon: "none",
      });
    } finally {
      this.setData({ submitting: false });
    }
  },
});
