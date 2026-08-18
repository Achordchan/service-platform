import { ensureLoggedIn } from "../../lib/auth";
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type NotificationItem,
} from "../../lib/api";
import { eventSync } from "../../lib/events";
import { ensureBadgeSync } from "../../lib/badge";
import { formatRelative, notificationTargetTab } from "../../lib/format";

Page({
  data: {
    loading: true,
    loadError: "",
    items: [] as Array<
      NotificationItem & { timeText: string; unread: boolean }
    >,
    totalUnread: 0,
    nextCursor: null as string | null,
    loadingMore: false,
  },
  boundEventHandler: null as ((events: Array<{ type: string }>) => void) | null,

  onLoad() {
    this.boundEventHandler = (events) => this.onRealtimeEvents(events);
  },
  onShow() {
    if (!ensureLoggedIn(() => this.activate())) return;
    this.activate();
  },
  activate() {
    ensureBadgeSync();
    if (this.boundEventHandler) {
      eventSync.on(this.boundEventHandler);
    }
    eventSync.start();
    void this.reload();
  },
  onHide() {
    if (this.boundEventHandler) {
      eventSync.off(this.boundEventHandler);
    }
    eventSync.stop();
  },
  onUnload() {
    if (this.boundEventHandler) {
      eventSync.off(this.boundEventHandler);
    }
    eventSync.stop();
  },
  onRealtimeEvents(events: Array<{ type: string }>) {
    if (events.some((event) => event.type === "NOTIFICATION_CREATED")) {
      void this.reload();
    }
  },
  onPullDownRefresh() {
    void this.reload().then(() => wx.stopPullDownRefresh());
  },
  onReachBottom() {
    if (!this.data.nextCursor || this.data.loadingMore) return;
    void this.loadMore();
  },
  async reload() {
    this.setData({ loading: true, loadError: "" });
    try {
      const result = await listNotifications({ limit: 30 });
      this.applyResult(result, true);
    } catch (error) {
      this.setData({
        loading: false,
        loadError:
          error instanceof Error ? error.message : "加载失败，请下拉重试",
      });
    }
  },
  async loadMore() {
    this.setData({ loadingMore: true });
    try {
      const result = await listNotifications({
        limit: 30,
        cursor: this.data.nextCursor ?? undefined,
      });
      this.applyResult(result, false);
    } catch {
      wx.showToast({ title: "加载更多失败", icon: "none" });
    } finally {
      this.setData({ loadingMore: false });
    }
  },
  applyResult(
    result: {
      items: NotificationItem[];
      totalUnread: number;
      nextCursor: string | null;
    },
    replace: boolean,
  ) {
    const decorated = result.items.map((item) => ({
      ...item,
      timeText: formatRelative(item.updatedAt),
      unread: item.readAt === null,
    }));
    this.setData({
      loading: false,
      items: replace ? decorated : [...this.data.items, ...decorated],
      totalUnread: result.totalUnread,
      nextCursor: result.nextCursor,
    });
  },
  async onMarkAll() {
    if (this.data.totalUnread === 0) return;
    try {
      await markAllNotificationsRead();
      await this.reload();
      wx.showToast({ title: "已全部标记已读", icon: "success" });
    } catch (error) {
      wx.showToast({
        title: error instanceof Error ? error.message : "操作失败",
        icon: "none",
      });
    }
  },
  async onTapItem(event: WechatMiniprogram.TouchEvent) {
    const index = Number(event.currentTarget.dataset.index);
    const item = this.data.items[index];
    if (!item) return;
    if (item.unread) {
      void markNotificationRead(item.id).catch(() => undefined);
      this.setData({
        [`items[${index}].unread`]: false,
        totalUnread: Math.max(0, this.data.totalUnread - 1),
      });
      ensureBadgeSync();
    }
    if (item.serviceRequestId) {
      wx.navigateTo({
        url: `/pages/request-detail/page?id=${item.serviceRequestId}`,
      });
    } else if (item.projectId) {
      const tab = notificationTargetTab(item.type);
      wx.navigateTo({
        url: `/pages/project-detail/page?id=${item.projectId}&tab=${tab}`,
      });
    }
  },
  onOpenSettings() {
    wx.navigateTo({ url: "/pages/notification-settings/page" });
  },
});
