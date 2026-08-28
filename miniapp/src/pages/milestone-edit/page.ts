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
  keepInlineImageTags,
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
  /**
   * 上一次已成功保存的内容快照。
   *
   * 附件上传失败时页面会留下来让用户重试，但重试会连实体一起再提交一次，
   * 而 updateMilestone 每次调用都无条件分发一条 PROJECT_MILESTONE 通知 ——
   * 字段一个没改也照发，于是重试几次就骚扰几次。内容与上次保存一致就跳过实体
   * 调用，只补传剩下的附件；用户若顺手改了字段，快照对不上，实体照常提交。
   */
  savedSnapshot: "",
  /** 编辑态载入时的原始描述与其纯文本形态：用于判断描述到底改没改 */
  loadedDescription: "",
  loadedDescText: "",
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
      const descText = milestone.description
        ? htmlToText(milestone.description)
        : "";
      this.loadedDescription = milestone.description ?? "";
      this.loadedDescText = descText;
      this.setData({
        loading: false,
        title: milestone.title,
        descText,
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
  /**
   * 返回上传失败的文件，由调用方决定提示与是否离页。
   *
   * 不能在这里吞掉失败：紧接着的「已发布/已保存」成功提示会盖掉失败提示，
   * 页面又自动返回，已选的本地文件随页面销毁，用户既不知道传丢了也没法重试。
   */
  async uploadPendingFiles(target: {
    projectUpdateId?: string;
    milestoneId?: string;
  }): Promise<PickedFile[]> {
    const failed: PickedFile[] = [];
    for (const file of this.data.files) {
      try {
        await uploadAttachment({
          filePath: file.localPath,
          fileName: file.fileName,
          projectId: this.data.projectId,
          ...target,
        });
      } catch {
        failed.push(file);
      }
    }
    return failed;
  },
  /**
   * 上传收尾：全成功才提示成功并允许离页；有失败就留在页面、只保留失败的文件，
   * 用户可以直接重试，不至于「看到成功提示、页面返回、文件其实没传上去」。
   * 返回 true 表示可以离页。
   */
  finishUpload(failed: PickedFile[], successTitle: string): boolean {
    if (failed.length === 0) {
      this.setData({ files: [] });
      wx.showToast({ title: successTitle, icon: "success" });
      return true;
    }
    this.setData({ files: failed });
    wx.showModal({
      title: "部分附件未上传",
      content: `内容已保存，但 ${failed.length} 个附件上传失败，已保留在下方，可重新提交。`,
      showCancel: false,
    });
    return false;
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
    const snapshot = JSON.stringify(payload);
    this.setData({ submitting: true });
    try {
      if (this.data.mode === "edit") {
        // 内容与上次成功保存的一致 = 这次只是重试没传成功的附件，
        // 不能再调一次 editMilestone（它每次都会分发一条 PROJECT_MILESTONE 通知）
        if (snapshot !== this.savedSnapshot) {
          // 与动态编辑同理：描述没动就别提交，真改了也要把原描述里的内嵌图标签
          // 原样接回去 —— 服务端会把描述里消失的附件 id 当成删除，连文件一起删
          const descChanged = descText !== this.loadedDescText.trim();
          const description = descChanged
            ? descText
              ? textToHtml(descText) +
                keepInlineImageTags(this.loadedDescription)
              : keepInlineImageTags(this.loadedDescription) || null
            : this.loadedDescription || null;
          await editMilestone(this.data.projectId, this.data.milestoneId, {
            ...withOverride,
            description,
          });
          this.loadedDescription = description ?? "";
          this.loadedDescText = descText;
          this.savedSnapshot = snapshot;
        }
        if (
          !this.finishUpload(
            await this.uploadPendingFiles({
              milestoneId: this.data.milestoneId,
            }),
            "已保存",
          )
        ) {
          return;
        }
      } else {
        const created = await createMilestone(this.data.projectId, withOverride);
        if (
          !this.finishUpload(
            await this.uploadPendingFiles({ milestoneId: created.id }),
            "已新增",
          )
        ) {
          // 里程碑已建好，留在页面上只重试剩下的附件。记下快照，
          // 下次提交只补传附件、不再重复创建或更新实体
          this.setData({ mode: "edit", milestoneId: created.id });
          this.loadedDescription = descText ? textToHtml(descText) : "";
          this.loadedDescText = descText;
          this.savedSnapshot = snapshot;
          return;
        }
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
