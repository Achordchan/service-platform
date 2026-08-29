import { ensureLoggedIn } from "../../lib/auth";
import { getDashboardAnalytics } from "../../lib/api";
import {
  REQUEST_PRIORITY_LABELS,
  REQUEST_STATUS_LABELS_STAFF,
  REQUEST_STATUS_TONES,
  type RequestPriorityValue,
  type RequestStatusValue,
} from "../../lib/format";

const OPEN_STATUSES = ["PENDING", "IN_PROGRESS", "WAITING_CUSTOMER"];

function formatMinutes(minutes: number): string {
  if (!minutes || minutes <= 0) return "—";
  if (minutes < 60) return `${Math.round(minutes)} 分钟`;
  const hours = minutes / 60;
  if (hours < 24) return `${hours.toFixed(1)} 小时`;
  return `${(hours / 24).toFixed(1)} 天`;
}

Page({
  data: {
    loading: true,
    loadError: "",
    openCount: 0,
    new30d: 0,
    statusRows: [] as Array<{
      status: string;
      label: string;
      tone: string;
      count: number;
    }>,
    responseRows: [] as Array<{
      priority: string;
      label: string;
      avgText: string;
      count: number;
    }>,
  },
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
    this.setData({ loading: true, loadError: "" });
    try {
      const data = await getDashboardAnalytics();
      const countByStatus = new Map(
        data.statusDistribution.map((row) => [row.status, row.count]),
      );
      const openCount = OPEN_STATUSES.reduce(
        (sum, status) => sum + (countByStatus.get(status) ?? 0),
        0,
      );
      const new30d = data.volumeTrend.reduce((sum, row) => sum + row.count, 0);
      this.setData({
        loading: false,
        openCount,
        new30d,
        statusRows: data.statusDistribution.map((row) => ({
          status: row.status,
          label:
            REQUEST_STATUS_LABELS_STAFF[row.status as RequestStatusValue] ??
            row.status,
          tone:
            REQUEST_STATUS_TONES[row.status as RequestStatusValue] ?? "neutral",
          count: row.count,
        })),
        responseRows: data.responseTimeByPriority.map((row) => ({
          priority: row.priority,
          label:
            REQUEST_PRIORITY_LABELS[row.priority as RequestPriorityValue] ??
            row.priority,
          avgText: formatMinutes(row.avgMinutes),
          count: row.count,
        })),
      });
    } catch (error) {
      const denied =
        error instanceof Error &&
        (error as { status?: number }).status === 403;
      this.setData({
        loading: false,
        loadError: denied
          ? "当前账号无权查看工作台"
          : error instanceof Error
            ? error.message
            : "加载失败，请下拉重试",
      });
    }
  },
  onOpenRequests() {
    wx.switchTab({ url: "/pages/requests/page" });
  },
});
