import { ensureLoggedIn } from "../../lib/auth";
import {
  createProjectUpdate,
  editProjectUpdate,
  listProjectUpdates,
  type ProjectUpdate,
  uploadAttachment,
} from "../../lib/api";
import { escapeHtml, htmlToText, keepInlineImageTags } from "../../lib/format";
import type { DeliveryOverride } from "../../lib/delivery";
import { pickAttachments, type PickedFile } from "../../lib/pick-files";

/** 纯文本 → 简单 HTML：空行分段，段内换行转 <br/>（服务端仍会 sanitize） */
function textToHtml(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((para) => para.trim())
    .filter(Boolean)
    .map((para) => `<p>${escapeHtml(para).replace(/\n/g, "<br/>")}</p>`)
    .join("");
}

Page({
  data: {
    projectId: "",
    updateId: "",
    mode: "create" as "create" | "edit",
    title: "",
    bodyText: "",
    // 仅创建时可选「仅内部可见」；编辑接口虽支持改可见性，但列表不回传当前值，故编辑不改
    internal: false,
    submitting: false,
    // 附件：与工单同一套两段式 —— 先建实体、再带 id 上传
    files: [] as PickedFile[],
    loading: false,
    loadError: "",
    // 本次发布的提醒方式覆盖（由 delivery-notice 组件回传）
    deliveryOverride: {} as DeliveryOverride,
    deliveryScene: null as unknown,
  },
  /** 载入与提交必须用同一个算法算快照，否则「一字未改」判不出来，等于没初始化 */
  contentSnapshot(title: string, text: string) {
    return JSON.stringify({ title: title.trim(), text: text.trim() });
  },
  /**
   * 上一次已成功保存的内容快照。
   *
   * 附件上传失败时页面会留下来让用户重试，但重试会连实体一起再提交一次，
   * 而 editProjectUpdate 每次调用都无条件分发一条 PROJECT_UPDATE 通知 ——
   * 字段一个没改也照发。内容与上次保存一致就跳过实体调用，只补传剩下的附件。
   */
  savedSnapshot: "",
  /** 编辑态载入时的原始正文与其纯文本形态：用于判断正文到底改没改 */
  loadedBody: "",
  loadedText: "",
  onLoad(query: Record<string, string | undefined>) {
    const projectId = query.projectId ?? "";
    const updateId = query.updateId ?? "";
    const mode: "create" | "edit" = updateId ? "edit" : "create";
    this.setData({
      projectId,
      updateId,
      mode,
      deliveryScene:
        mode === "create"
          ? { scene: "PROJECT_UPDATE", projectId, visibility: "CUSTOMER_VISIBLE" }
          : null,
    });
    wx.setNavigationBarTitle({
      title: mode === "edit" ? "编辑动态" : "发布进度动态",
    });
    if (mode === "edit") void this.loadExisting();
  },
  onShow() {
    // 子页面兜底鉴权：token 丢失则回登录页
    ensureLoggedIn();
  },
  async loadExisting() {
    this.setData({ loading: true, loadError: "" });
    try {
      const updates = await listProjectUpdates(this.data.projectId);
      const update = updates.find(
        (item: ProjectUpdate) => item.id === this.data.updateId,
      );
      if (!update) {
        this.setData({ loading: false, loadError: "动态不存在或已被删除" });
        return;
      }
      const bodyText = htmlToText(update.body);
      this.loadedBody = update.body;
      this.loadedText = bodyText;
      // 快照必须按载入值初始化：留空的话首次提交必然与它不同，
      // 于是一字未改（或只补传附件）也会调 editProjectUpdate 发一条更新通知
      this.savedSnapshot = this.contentSnapshot(update.title, bodyText);
      this.setData({
        loading: false,
        title: update.title,
        // 编辑器是纯文本：HTML 正文转文本回填（会丢富格式，移动端快速编辑取舍）
        bodyText,
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
  onBodyInput(event: WechatMiniprogram.TextareaInput) {
    this.setData({ bodyText: event.detail.value });
  },
  onToggleInternal(event: WechatMiniprogram.SwitchChange) {
    const internal = event.detail.value;
    this.setData({
      internal,
      // 可见性变了收件人也跟着变，场景要同步刷新
      deliveryScene: {
        scene: "PROJECT_UPDATE",
        projectId: this.data.projectId,
        visibility: internal ? "INTERNAL" : "CUSTOMER_VISIBLE",
      },
      deliveryOverride: {},
    });
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
    const text = this.data.bodyText.trim();
    if (!title) {
      wx.showToast({ title: "请填写动态标题", icon: "none" });
      return;
    }
    if (!text) {
      wx.showToast({ title: "请填写进度说明", icon: "none" });
      return;
    }
    const body = textToHtml(text);
    if (!body) {
      wx.showToast({ title: "请填写进度说明", icon: "none" });
      return;
    }
    const snapshot = this.contentSnapshot(title, text);
    this.setData({ submitting: true });
    try {
      if (this.data.mode === "edit") {
        // 内容与上次成功保存的一致 = 这次只是重试没传成功的附件，
        // 不能再调一次 editProjectUpdate（它每次都会分发一条通知）
        if (snapshot !== this.savedSnapshot) {
          // 正文没动就别提交 body：纯文本编辑器还原不出原来的富文本，
          // 提交等于拿降级后的版本覆盖原文
          const textChanged = text !== this.loadedText.trim();
          // 真改了正文，也要把原正文里的内嵌图标签原样接回去 —— 服务端会把
          // 正文里消失的附件 id 当成删除，连附件行和存储文件一起删掉
          const bodyForEdit = textChanged
            ? body + keepInlineImageTags(this.loadedBody)
            : undefined;
          await editProjectUpdate(this.data.projectId, this.data.updateId, {
            title,
            ...(bodyForEdit ? { body: bodyForEdit } : {}),
          });
          if (bodyForEdit) {
            this.loadedBody = bodyForEdit;
            this.loadedText = text;
          }
          this.savedSnapshot = snapshot;
        }
        // 编辑态也要把已选附件传上去，否则提示「已更新」但文件从没上传
        if (
          !this.finishUpload(
            await this.uploadPendingFiles({
              projectUpdateId: this.data.updateId,
            }),
            "已更新",
          )
        ) {
          return;
        }
      } else {
        const override = this.data.deliveryOverride;
        const created = await createProjectUpdate(this.data.projectId, {
          title,
          body,
          visibility: this.data.internal ? "INTERNAL" : undefined,
          ...(Object.keys(override).length > 0
            ? { deliveryOverride: override }
            : {}),
        });
        if (
          !this.finishUpload(
            await this.uploadPendingFiles({ projectUpdateId: created.id }),
            "已发布",
          )
        ) {
          // 实体已建好，留在页面上只重试剩下的附件（files 只剩失败的那几个）。
          // 记下快照，下次提交只补传附件、不再重复创建或更新实体
          this.setData({ mode: "edit", updateId: created.id });
          this.loadedBody = body;
          this.loadedText = text;
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
