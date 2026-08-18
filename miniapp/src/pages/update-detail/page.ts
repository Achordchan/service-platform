import { ensureLoggedIn } from "../../lib/auth";
import {
  listProjectUpdates,
  downloadAttachment,
  type ProjectUpdate,
} from "../../lib/api";
import {
  extractInlineImages,
  formatRelative,
  htmlToText,
} from "../../lib/format";

type CommentView = {
  id: string;
  body: string;
  authorName: string;
  timeText: string;
};

Page({
  data: {
    loading: true,
    loadError: "",
    canRetry: true,
    title: "",
    body: "",
    authorName: "",
    timeText: "",
    images: [] as Array<{ id: string; name: string; localPath: string }>,
    comments: [] as CommentView[],
  },
  onLoad() {},
  onShow() {
    if (!ensureLoggedIn(() => this.load())) return;
    void this.load();
  },
  onRetry() {
    void this.load();
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
    this.setData({ loading: true, loadError: "" });
    try {
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
      this.setData({
        loading: false,
        title: update.title,
        body: html,
        authorName: update.author.name,
        timeText: formatRelative(update.createdAt),
        images: images.map((image) => ({ ...image, localPath: "" })),
        comments: update.comments.map((comment) => ({
          id: comment.id,
          body: htmlToText(comment.body),
          authorName: comment.author.name,
          timeText: formatRelative(comment.createdAt),
        })),
      });
      wx.setNavigationBarTitle({ title: update.title || "项目动态" });
      // wx <image> 无法携带登录态，先下载到本地再展示（点击可全屏预览）
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
});
