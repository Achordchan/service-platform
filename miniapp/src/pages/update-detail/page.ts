import { cancelPendingActivate, ensureLoggedIn, fetchMeCached, projectDeliveryCaps, type MiniappMe } from "../../lib/auth";
import { eventSync } from "../../lib/events";
import {
  getProject,
  listProjectUpdates,
  downloadAttachment,
  createUpdateComment,
  editUpdateComment,
  deleteUpdateComment,
  deleteProjectUpdate,
  type ProjectUpdate,
} from "../../lib/api";
import {
  escapeHtml,
  extractInlineImages,
  formatRelative,
  htmlToText,
  isTextAttachment,
  formatFileSize,
} from "../../lib/format";

type CommentView = {
  id: string;
  body: string;
  rawText: string;
  authorName: string;
  timeText: string;
  isMine: boolean;
};

function textToHtml(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  return `<p>${escapeHtml(trimmed).replace(/\n/g, "<br/>")}</p>`;
}

Page({
  data: {
    projectId: "",
    updateId: "",
    loading: true,
    loadError: "",
    canRetry: true,
    title: "",
    body: "",
    authorName: "",
    timeText: "",
    images: [] as Array<{ id: string; name: string; localPath: string }>,
    attachments: [] as Array<{
      id: string;
      name: string;
      note: string;
      isText: boolean;
      sizeText: string;
    }>,
    comments: [] as CommentView[],
    // 能力
    canPublishUpdate: false,
    canComment: false,
    // 评论输入
    commentText: "",
    commentSubmitting: false,
  },
  me: null as MiniappMe | null,

  boundEventHandler: null as
    | ((
        events: Array<{
          type: string;
          projectId: string | null;
          payload?: Record<string, unknown>;
        }>,
      ) => void)
    | null,
  sseStarted: false,
  // 校验中挂起的 activate；onHide/onUnload 需取消
  pendingActivate: null as (() => void) | null,
  onLoad() {
    this.boundEventHandler = (events) => this.onRealtimeEvents(events);
  },
  onShow() {
    // 必须存下同一个函数引用：cancelAuthWaiter 按引用取消，每次现造匿名箭头
    // 函数就取消不掉 —— 校验完成后会唤醒已隐藏页面的 activate，
    // eventSync 计数只增不减，最后连登出都清不干净
    const activate = () => void this.activate();
    this.pendingActivate = activate;
    if (!ensureLoggedIn(activate)) return;
    void this.activate();
  },
  activate() {
    this.pendingActivate = null;
    // 别人评论/编辑这条动态时实时刷新，不必下拉
    if (this.boundEventHandler) {
      eventSync.on(this.boundEventHandler);
    }
    eventSync.start();
    this.sseStarted = true;
    void this.load();
  },
  teardown() {
    if (this.pendingActivate) {
      cancelPendingActivate(this.pendingActivate);
      this.pendingActivate = null;
    }
    if (!this.sseStarted) return;
    this.sseStarted = false;
    if (this.boundEventHandler) {
      eventSync.off(this.boundEventHandler);
    }
    eventSync.stop();
  },
  onHide() {
    this.teardown();
  },
  onUnload() {
    this.teardown();
  },
  onRealtimeEvents(
    events: Array<{
      type: string;
      projectId: string | null;
      payload?: Record<string, unknown>;
    }>,
  ) {
    const projectId = this.data.projectId;
    const hit = events.some((event) => {
      if (event.projectId !== projectId) return false;
      if (event.type === "UPDATE_COMMENT_CREATED") return true;
      const change = event.payload?.change;
      return (
        typeof change === "string" &&
        [
          "UPDATE_COMMENT_UPDATED",
          "UPDATE_COMMENT_DELETED",
          "PROJECT_UPDATE_UPDATED",
          "PROJECT_UPDATE_DELETED",
        ].includes(change)
      );
    });
    if (hit) void this.load();
  },
  onRetry() {
    void this.load();
  },
  onOpenAttachment(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id ?? "");
    const isText = event.currentTarget.dataset.istext === true;
    const name = String(event.currentTarget.dataset.name ?? "");
    if (!id) return;
    if (isText) {
      wx.navigateTo({
        url: `/pages/attachment-text/page?id=${id}&name=${encodeURIComponent(name)}`,
      });
      return;
    }
    wx.showLoading({ title: "下载文件" });
    void downloadAttachment(id)
      .then((localPath) => {
        wx.hideLoading();
        return wx.openDocument({ filePath: localPath, showMenu: true });
      })
      .catch((error: unknown) => {
        wx.hideLoading();
        wx.showToast({
          title: error instanceof Error ? error.message : "打开失败",
          icon: "none",
        });
      });
  },
  onPullDownRefresh() {
    void this.load().then(() => wx.stopPullDownRefresh());
  },
  async load() {
    const pages = getCurrentPages();
    const current = pages[pages.length - 1] as {
      options: Record<string, string | undefined>;
    };
    const projectId = current.options.projectId ?? "";
    const updateId = current.options.updateId ?? "";
    if (!projectId || !updateId) {
      this.setData({
        loading: false,
        canRetry: false,
        loadError: "缺少参数，请返回重进",
      });
      return;
    }
    this.setData({ loading: true, loadError: "", projectId, updateId });
    try {
      // 能力推导：需要我的身份 + 我在该项目的角色
      let canPublishUpdate = false;
      let canComment = false;
      try {
        this.me = await fetchMeCached();
        if (this.me.isStaff) {
          const project = await getProject(projectId);
          const caps = projectDeliveryCaps(this.me, project.staff);
          canPublishUpdate = caps.canPublishUpdate;
          canComment = caps.canComment;
        }
      } catch {
        // 拿不到身份/项目：按无写权限展示
      }
      const updates = await listProjectUpdates(projectId);
      const update = updates.find(
        (item: ProjectUpdate) => item.id === updateId,
      );
      if (!update) {
        this.setData({
          loading: false,
          canRetry: false,
          loadError: "动态不存在或已被删除",
        });
        return;
      }
      const { html, images } = extractInlineImages(update.body);
      const myId = this.me?.user.id ?? "";
      this.setData({
        loading: false,
        title: update.title,
        body: html,
        authorName: update.author.name,
        timeText: formatRelative(update.createdAt),
        images: images.map((image) => ({ ...image, localPath: "" })),
        attachments: (update.attachments ?? []).map((att) => ({
          id: att.id,
          name: att.title || att.originalName,
          note: att.note || "",
          isText: isTextAttachment(att.mimeType),
          sizeText: formatFileSize(att.size),
        })),
        comments: update.comments.map((comment) => ({
          id: comment.id,
          body: htmlToText(comment.body),
          rawText: htmlToText(comment.body),
          authorName: comment.author.name,
          timeText: formatRelative(comment.createdAt),
          isMine: Boolean(myId) && comment.author.id === myId,
        })),
        canPublishUpdate,
        canComment,
      });
      wx.setNavigationBarTitle({ title: update.title || "项目动态" });
      images.forEach((image, index) => {
        void downloadAttachment(image.id)
          .then((localPath) => {
            this.setData({ [`images[${index}].localPath`]: localPath });
          })
          .catch(() => undefined);
      });
    } catch (error) {
      this.setData({
        loading: false,
        loadError:
          error instanceof Error ? error.message : "加载失败，请下拉重试",
      });
    }
  },
  async onPreviewImage(event: WechatMiniprogram.TouchEvent) {
    const index = Number(event.currentTarget.dataset.index);
    const image = this.data.images[index];
    if (!image?.localPath) {
      wx.showToast({ title: "图片加载中，请稍候", icon: "none" });
      return;
    }
    const allPaths = this.data.images
      .map((item) => item.localPath)
      .filter(Boolean);
    await wx.previewImage({ current: image.localPath, urls: allPaths });
  },

  // —— 动态编辑 / 删除（canPublishUpdate）——

  onEditUpdate() {
    wx.navigateTo({
      url: `/pages/update-edit/page?projectId=${this.data.projectId}&updateId=${this.data.updateId}`,
    });
  },
  onDeleteUpdate() {
    wx.showModal({
      title: "删除动态",
      content: "确定删除这条进度动态吗？此操作不可撤销。",
      confirmText: "删除",
      confirmColor: "#d14343",
      success: (res) => {
        if (!res.confirm) return;
        void deleteProjectUpdate(this.data.projectId, this.data.updateId)
          .then(() => {
            wx.showToast({ title: "已删除", icon: "success" });
            setTimeout(() => wx.navigateBack(), 500);
          })
          .catch((error: unknown) => {
            wx.showToast({
              title: error instanceof Error ? error.message : "删除失败",
              icon: "none",
            });
          });
      },
    });
  },

  // —— 评论 ——

  onCommentInput(event: WechatMiniprogram.Input) {
    this.setData({ commentText: event.detail.value });
  },
  async onSubmitComment() {
    if (this.data.commentSubmitting) return;
    const body = textToHtml(this.data.commentText);
    if (!body) {
      wx.showToast({ title: "请输入评论内容", icon: "none" });
      return;
    }
    this.setData({ commentSubmitting: true });
    try {
      await createUpdateComment(this.data.projectId, this.data.updateId, body);
      this.setData({ commentText: "" });
      await this.load();
    } catch (error) {
      wx.showToast({
        title: error instanceof Error ? error.message : "评论失败，请重试",
        icon: "none",
      });
    } finally {
      this.setData({ commentSubmitting: false });
    }
  },
  onCommentActions(event: WechatMiniprogram.TouchEvent) {
    const id = event.currentTarget.dataset.id as string;
    const comment = this.data.comments.find((item) => item.id === id);
    if (!comment || !comment.isMine) return;
    wx.showActionSheet({
      itemList: ["编辑评论", "删除评论"],
      success: (res) => {
        if (res.tapIndex === 0) this.editComment(comment);
        else if (res.tapIndex === 1) this.deleteComment(comment.id);
      },
    });
  },
  editComment(comment: CommentView) {
    wx.showModal({
      title: "编辑评论",
      editable: true,
      content: comment.rawText,
      success: (res) => {
        if (!res.confirm) return;
        const body = textToHtml(res.content ?? "");
        if (!body) {
          wx.showToast({ title: "评论内容不能为空", icon: "none" });
          return;
        }
        void editUpdateComment(
          this.data.projectId,
          this.data.updateId,
          comment.id,
          body,
        )
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
    });
  },
  deleteComment(commentId: string) {
    wx.showModal({
      title: "删除评论",
      content: "确定删除这条评论吗？",
      confirmText: "删除",
      confirmColor: "#d14343",
      success: (res) => {
        if (!res.confirm) return;
        void deleteUpdateComment(
          this.data.projectId,
          this.data.updateId,
          commentId,
        )
          .then(() => {
            wx.showToast({ title: "已删除", icon: "success" });
            void this.load();
          })
          .catch((error: unknown) => {
            wx.showToast({
              title: error instanceof Error ? error.message : "删除失败",
              icon: "none",
            });
          });
      },
    });
  },
});
