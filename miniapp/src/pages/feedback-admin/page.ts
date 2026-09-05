import { ensureLoggedIn } from "../../lib/auth";
import { formatAuditTime } from "../../lib/audit";
import { listFeedback, type FeedbackAdminRow } from "../../lib/api";

const PAGE_SIZE = 25;

const ROLE_LABELS: Record<string, string> = {
  PLATFORM_ADMIN: "平台管理员",
  PROJECT_MANAGER: "项目负责人",
  TECHNICIAN: "技术人员",
  CUSTOMER: "客户",
};

const PLATFORM_INFO_LABELS: Record<string, string> = {
  userAgent: "浏览器标识",
  model: "机型",
  system: "系统",
  platform: "平台",
  sdkVersion: "基础库版本",
  appVersion: "小程序版本",
};

const SOURCE_OPTIONS = [
  { value: "", label: "全部来源" },
  { value: "WEB", label: "Web 端" },
  { value: "MINIAPP", label: "小程序" },
];

// 标签与后端 issueStatusLabel 对齐；PENDING 只有崩溃残留才出现，也留着兜底
const STATUS_OPTIONS = [
  { value: "", label: "全部状态" },
  { value: "CREATED", label: "已建 issue" },
  { value: "FAILED", label: "建 issue 失败" },
  { value: "PENDING", label: "待同步" },
  { value: "SKIPPED", label: "未同步（未配置）" },
];

type ChipOption = { value: string; label: string };

type DetailItem = {
  label: string;
  value: string;
  mono?: boolean;
  copy?: boolean;
  prewrap?: boolean;
};

type Row = FeedbackAdminRow & { timeText: string };

Page({
  data: {
    loading: true,
    loadError: "",
    rows: [] as Row[],
    page: 0,
    total: 0,
    hasMore: false,
    loadingMore: false,

    // 已生效的筛选条件（keyword 是输入框草稿，确认后才写进 search）
    keyword: "",
    search: "",
    source: "",
    issueStatus: "",
    filtersActive: false,

    sourceOptions: SOURCE_OPTIONS,
    statusOptions: STATUS_OPTIONS,

    detailVisible: false,
    detailTitle: "",
    detailItems: [] as DetailItem[],
  },
  /**
   * reload 代次。切筛选条件会并发出多个请求，只有最新一次的响应能落到 data，
   * 否则旧条件的结果后到会盖掉刚选的条件下列表，看起来像筛选没生效。
   */
  reloadSeq: 0,
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
    if (this.data.loading || !this.data.hasMore || this.data.loadingMore) return;
    void this.loadMore();
  },
  noop() {},

  // —— 搜索与筛选 chips ——
  onKeywordInput(event: WechatMiniprogram.Input) {
    this.setData({ keyword: event.detail.value });
  },
  onSearchConfirm() {
    const search = this.data.keyword.trim();
    if (search === this.data.search) return;
    this.setData({ search });
    this.applyFilters();
  },
  onSourceTap(event: WechatMiniprogram.TouchEvent) {
    const value = String(event.currentTarget.dataset.value ?? "");
    if (value === this.data.source) return;
    this.setData({ source: value });
    this.applyFilters();
  },
  onStatusTap(event: WechatMiniprogram.TouchEvent) {
    const value = String(event.currentTarget.dataset.value ?? "");
    if (value === this.data.issueStatus) return;
    this.setData({ issueStatus: value });
    this.applyFilters();
  },
  /** 条件变化后统一重算角标并回到第一页 */
  applyFilters() {
    this.setData({
      filtersActive: Boolean(
        this.data.search || this.data.source || this.data.issueStatus,
      ),
    });
    void this.reload();
  },
  currentFilters() {
    return {
      search: this.data.search || undefined,
      source: this.data.source || undefined,
      issueStatus: this.data.issueStatus || undefined,
    };
  },

  // —— 详情 ——
  onOpenDetail(event: WechatMiniprogram.TouchEvent) {
    const index = Number(event.currentTarget.dataset.index);
    const row = this.data.rows[index];
    if (!row) return;
    this.setData({
      detailVisible: true,
      detailTitle: row.title,
      detailItems: this.buildDetailItems(row),
    });
  },
  onCloseDetail() {
    this.setData({ detailVisible: false });
  },
  onCopyValue(event: WechatMiniprogram.TouchEvent) {
    const { copy, value } = event.currentTarget.dataset as {
      copy?: boolean;
      value?: string;
    };
    if (!copy || !value) return;
    wx.setClipboardData({ data: value, success: () => undefined });
  },
  buildDetailItems(row: FeedbackAdminRow): DetailItem[] {
    const items: DetailItem[] = [
      { label: "内容", value: row.content, prewrap: true },
      { label: "时间", value: formatAuditTime(row.createdAt) },
    ];
    if (row.submitter) {
      const role = ROLE_LABELS[row.submitter.platformRole];
      items.push({
        label: "提交人",
        value: role
          ? `${row.submitter.name}（${row.submitter.email} · ${role}）`
          : `${row.submitter.name}（${row.submitter.email}）`,
      });
    }
    items.push({
      label: "来源",
      value: row.appVersion
        ? `${row.sourceLabel} · 版本 ${row.appVersion}`
        : row.sourceLabel,
    });
    if (row.platformInfo) {
      for (const [key, raw] of Object.entries(row.platformInfo)) {
        const value = String(raw ?? "").trim();
        if (!value) continue;
        items.push({
          label: PLATFORM_INFO_LABELS[key] ?? key,
          value,
          mono: key === "userAgent",
        });
      }
    }
    if (row.issueUrl) {
      items.push({
        label: "GitHub issue",
        value: `#${row.issueNumber ?? ""} ${row.issueUrl}`.trim(),
        mono: true,
        copy: true,
      });
    } else {
      items.push({
        label: "GitHub issue",
        value: row.issueError
          ? `${row.issueStatusLabel}（${row.issueError}）`
          : row.issueStatusLabel,
      });
    }
    return items;
  },

  decorate(rows: FeedbackAdminRow[]): Row[] {
    return rows.map((row) => ({
      ...row,
      timeText: formatAuditTime(row.createdAt),
    }));
  },
  async reload() {
    const seq = ++this.reloadSeq;
    // 分页状态一并清空：在途的翻页属于旧条件，残留的 page/hasMore 会让
    // onReachBottom 拿旧页码去翻新列表
    this.setData({
      loading: true,
      loadError: "",
      loadingMore: false,
      page: 0,
      hasMore: false,
    });
    try {
      const result = await listFeedback({
        ...this.currentFilters(),
        page: 0,
        pageSize: PAGE_SIZE,
      });
      if (seq !== this.reloadSeq) return;
      this.setData({
        loading: false,
        rows: this.decorate(result.rows),
        page: 0,
        total: result.total,
        hasMore: (result.page + 1) * result.pageSize < result.total,
      });
    } catch (error) {
      if (seq !== this.reloadSeq) return;
      const denied =
        error instanceof Error &&
        (error as { status?: number }).status === 403;
      this.setData({
        loading: false,
        loadError: denied
          ? "仅员工可查看反馈列表"
          : error instanceof Error
            ? error.message
            : "加载失败，请下拉重试",
      });
    }
  },
  async loadMore() {
    const seq = this.reloadSeq;
    const nextPage = this.data.page + 1;
    this.setData({ loadingMore: true });
    try {
      const result = await listFeedback({
        ...this.currentFilters(),
        page: nextPage,
        pageSize: PAGE_SIZE,
      });
      // 期间换过筛选条件：这页属于旧条件，接到新列表后面就是串数据
      if (seq !== this.reloadSeq) return;
      this.setData({
        loadingMore: false,
        rows: [...this.data.rows, ...this.decorate(result.rows)],
        page: result.page,
        total: result.total,
        hasMore: (result.page + 1) * result.pageSize < result.total,
      });
    } catch {
      if (seq !== this.reloadSeq) return;
      this.setData({ loadingMore: false });
      wx.showToast({ title: "加载更多失败", icon: "none" });
    }
  },
});
