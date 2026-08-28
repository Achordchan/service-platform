import { downloadAttachment } from "../../lib/api";

// 文本类附件（txt/log/csv/json）wx.openDocument 不支持，
// 下载到本地后读出内容用 scroll-view 展示；超长内容截断避免 setData 超限。
const MAX_DISPLAY_CHARS = 200_000;

Page({
  data: {
    loading: true,
    error: "",
    content: "",
    truncated: false,
  },
  attachmentId: "",
  // 上传前预览：直接传本地临时文件路径，不走附件下载
  localPath: "",
  // 完整内容留在实例字段（不进 setData，避免超限），复制全文用它
  fullContent: "",

  onLoad(query: Record<string, string | undefined>) {
    this.attachmentId = query.id ?? "";
    this.localPath = query.path ? decodeURIComponent(query.path) : "";
    const name = query.name ? decodeURIComponent(query.name) : "";
    if (name) {
      wx.setNavigationBarTitle({ title: name });
    }
    void this.load();
  },
  onRetry() {
    this.setData({ loading: true, error: "" });
    void this.load();
  },
  async load() {
    if (!this.attachmentId && !this.localPath) {
      this.setData({ loading: false, error: "缺少附件参数" });
      return;
    }
    try {
      const localPath =
        this.localPath || (await downloadAttachment(this.attachmentId));
      const content = await new Promise<string>((resolve, reject) => {
        wx.getFileSystemManager().readFile({
          filePath: localPath,
          encoding: "utf8",
          success: (res) => resolve(res.data as string),
          fail: () => reject(new Error("文件内容读取失败")),
        });
      });
      this.fullContent = content;
      this.setData({
        loading: false,
        content: content.slice(0, MAX_DISPLAY_CHARS),
        truncated: content.length > MAX_DISPLAY_CHARS,
      });
    } catch (error) {
      this.setData({
        loading: false,
        error: error instanceof Error ? error.message : "加载失败，请重试",
      });
    }
  },
  onCopyAll() {
    const full = this.fullContent || this.data.content;
    if (!full) return;
    wx.setClipboardData({
      data: full,
      fail: () => wx.showToast({ title: "复制失败", icon: "none" }),
    });
  },
});
