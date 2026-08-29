import { ensureLoggedIn, fetchMeCached, projectDeliveryCaps } from "../../lib/auth";
import {
  deleteMilestone,
  downloadAttachment,
  getProject,
  listMilestones,
  type Milestone,
} from "../../lib/api";
import {
  extractInlineImages,
  formatDateTime,
  formatFileSize,
  isTextAttachment,
  MILESTONE_STATUS_LABELS,
  MILESTONE_STATUS_TONES,
  type MilestoneStatusValue,
} from "../../lib/format";

/**
 * 里程碑详情：与动态详情同构 —— 列表只给两行预览，全文在这里。
 * 编辑 / 删除也收在这里，列表不再是「员工才点得动」的隐藏入口。
 */
Page({
  data: {
    projectId: "",
    milestoneId: "",
    loading: true,
    loadError: "",
    title: "",
    statusLabel: "",
    statusTone: "neutral",
    dateText: "",
    body: "",
    hasBody: false,
    images: [] as Array<{ id: string; name: string }>,
    attachments: [] as Array<{
      id: string;
      name: string;
      note: string;
      isText: boolean;
      sizeText: string;
    }>,
    canManage: false,
  },
  onLoad(query: Record<string, string | undefined>) {
    this.setData({
      projectId: query.projectId ?? "",
      milestoneId: query.milestoneId ?? "",
    });
  },
  onShow() {
    if (!ensureLoggedIn(() => void this.load())) return;
    void this.load();
  },
  onPullDownRefresh() {
    void this.load().then(() => wx.stopPullDownRefresh());
  },
  async load() {
    this.setData({ loading: true, loadError: "" });
    try {
      const [result, me] = await Promise.all([
        listMilestones(this.data.projectId),
        fetchMeCached().catch(() => null),
      ]);
      const milestone = result.milestones.find(
        (item: Milestone) => item.id === this.data.milestoneId,
      );
      if (!milestone) {
        this.setData({ loading: false, loadError: "里程碑不存在或已被删除" });
        return;
      }
      // 说明可能带 attachment:// 内嵌图，rich-text 加载不了 → 剥出来单独列
      const { html, images } = extractInlineImages(milestone.description ?? "");
      let canManage = false;
      if (me?.isStaff) {
        const project = await getProject(this.data.projectId).catch(() => null);
        canManage = project
          ? projectDeliveryCaps(me, project.staff).canManageDelivery
          : false;
      }
      const start = formatDateTime(milestone.startDate).slice(0, 10);
      const end = formatDateTime(milestone.endDate).slice(0, 10);
      this.setData({
        loading: false,
        title: milestone.title,
        statusLabel:
          MILESTONE_STATUS_LABELS[milestone.status as MilestoneStatusValue] ??
          milestone.status,
        statusTone:
          MILESTONE_STATUS_TONES[milestone.status as MilestoneStatusValue] ??
          "neutral",
        dateText: `${start} ~ ${end}`,
        body: html,
        hasBody: html.trim().length > 0,
        images: images.map((image) => ({ id: image.id, name: image.name })),
        attachments: (milestone.attachments ?? []).map((att) => ({
          id: att.id,
          name: att.title || att.originalName,
          note: att.note || "",
          isText: isTextAttachment(att.mimeType),
          sizeText: formatFileSize(att.size),
        })),
        canManage,
      });
      wx.setNavigationBarTitle({ title: milestone.title });
    } catch (error) {
      this.setData({
        loading: false,
        loadError: error instanceof Error ? error.message : "加载失败",
      });
    }
  },
  onOpenImage(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id ?? "");
    if (!id) return;
    wx.showLoading({ title: "加载图片" });
    void downloadAttachment(id)
      .then((localPath) => {
        wx.hideLoading();
        return wx.previewImage({ urls: [localPath] });
      })
      .catch((error: unknown) => {
        wx.hideLoading();
        wx.showToast({
          title: error instanceof Error ? error.message : "图片加载失败",
          icon: "none",
        });
      });
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
  onEdit() {
    if (!this.data.canManage) return;
    wx.navigateTo({
      url: `/pages/milestone-edit/page?projectId=${this.data.projectId}&milestoneId=${this.data.milestoneId}`,
    });
  },
  onDelete() {
    if (!this.data.canManage) return;
    wx.showModal({
      title: "删除里程碑",
      content: `确定删除「${this.data.title}」吗？此操作不可撤销。`,
      confirmText: "删除",
      confirmColor: "#d14343",
      success: (res) => {
        if (!res.confirm) return;
        void deleteMilestone(this.data.projectId, this.data.milestoneId)
          .then(() => {
            wx.showToast({ title: "已删除", icon: "success" });
            setTimeout(() => wx.navigateBack(), 600);
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
