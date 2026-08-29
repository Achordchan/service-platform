import { ensureLoggedIn } from "../../lib/auth";
import { listAuditLogs, type AuditRow } from "../../lib/api";
import { formatDateTime } from "../../lib/format";

const PAGE_SIZE = 25;

type Row = AuditRow & { timeText: string; failed: boolean };

Page({
  data: {
    loading: true,
    loadError: "",
    rows: [] as Row[],
    page: 0,
    total: 0,
    hasMore: false,
    loadingMore: false,
  },
  onShow() {
    if (!ensureLoggedIn(() => this.reload())) return;
    void this.reload();
  },
  onRetry() {
    void this.reload();
  },
  onPullDownRefresh() {
    void this.reload().then(() => wx.stopPullDownRefresh());
  },
  onReachBottom() {
    if (!this.data.hasMore || this.data.loadingMore) return;
    void this.loadMore();
  },
  decorate(rows: AuditRow[]): Row[] {
    return rows.map((row) => ({
      ...row,
      timeText: formatDateTime(row.createdAt),
      failed: row.result === "FAILURE",
    }));
  },
  async reload() {
    this.setData({ loading: true, loadError: "" });
    try {
      const result = await listAuditLogs({ page: 0, pageSize: PAGE_SIZE });
      this.setData({
        loading: false,
        rows: this.decorate(result.rows),
        page: 0,
        total: result.total,
        hasMore: (result.page + 1) * result.pageSize < result.total,
      });
    } catch (error) {
      const denied =
        error instanceof Error &&
        (error as { status?: number }).status === 403;
      this.setData({
        loading: false,
        loadError: denied
          ? "仅平台管理员可查看审计日志"
          : error instanceof Error
            ? error.message
            : "加载失败，请下拉重试",
      });
    }
  },
  async loadMore() {
    const nextPage = this.data.page + 1;
    this.setData({ loadingMore: true });
    try {
      const result = await listAuditLogs({
        page: nextPage,
        pageSize: PAGE_SIZE,
      });
      this.setData({
        loadingMore: false,
        rows: [...this.data.rows, ...this.decorate(result.rows)],
        page: result.page,
        total: result.total,
        hasMore: (result.page + 1) * result.pageSize < result.total,
      });
    } catch {
      this.setData({ loadingMore: false });
      wx.showToast({ title: "加载更多失败", icon: "none" });
    }
  },
});
