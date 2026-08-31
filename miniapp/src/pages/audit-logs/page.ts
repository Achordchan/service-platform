import { ensureLoggedIn } from "../../lib/auth";
import {
  listAuditLogs,
  type AuditFacetOption,
  type AuditFacets,
  type AuditRow,
} from "../../lib/api";
import {
  auditDetailItems,
  auditFilterCount,
  formatAuditMetadata,
  formatAuditTime,
  keepActiveOption,
  msUntilNextRollover,
  shanghaiToday,
  type AuditDetailItem,
} from "../../lib/audit";

const PAGE_SIZE = 25;

const ALL_OPTION: AuditFacetOption = { value: "", label: "全部" };

// facets 回来前先用这两个已知取值撑住结果 chips，避免筛选条第一屏是空的
const DEFAULT_RESULT_OPTIONS: AuditFacetOption[] = [
  ALL_OPTION,
  { value: "SUCCESS", label: "成功" },
  { value: "FAILURE", label: "失败" },
];

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

    // 已生效的筛选条件（keyword 是输入框草稿，确认后才写进 search）
    keyword: "",
    search: "",
    action: "",
    resourceType: "",
    result: "",
    from: "",
    to: "",
    filterCount: 0,
    filtersActive: false,

    // 服务端下发的筛选项（已带中文标签）
    facetsLoaded: false,
    actionOptions: [ALL_OPTION] as AuditFacetOption[],
    resourceOptions: [ALL_OPTION] as AuditFacetOption[],
    resultOptions: DEFAULT_RESULT_OPTIONS,

    // 更多筛选面板：面板内改 draft，点「应用」才落到上面的条件
    filterVisible: false,
    draftAction: "",
    draftActionIndex: 0,
    draftResourceType: "",
    draftResourceIndex: 0,
    draftFrom: "",
    draftTo: "",
    maxDate: shanghaiToday(),

    detailVisible: false,
    detailTitle: "",
    detailItems: [] as AuditDetailItem[],
    detailMetadata: "",
  },
  /**
   * reload 代次。切筛选条件会并发出多个请求，只有最新一次的响应能落到 data ——
   * 否则「初次未筛选的请求」后到就会盖掉刚选的条件下的列表，而 chips 还停在新
   * 条件上，看起来像筛选没生效。
   */
  reloadSeq: 0,
  /** 跨本地零点时重排时间文案的定时器（页面隐藏期间不留） */
  rolloverTimer: 0,
  onShow() {
    // 日期选择器上限跟着当天走：应用长时间挂在后台跨过零点也不会停在昨天
    this.setData({ maxDate: shanghaiToday() });
    this.scheduleRollover();
    if (!ensureLoggedIn(() => this.reload())) return;
    void this.reload();
  },
  onHide() {
    this.clearRollover();
  },
  onUnload() {
    this.clearRollover();
  },
  /**
   * 页面停在前台跨过零点、期间既不翻页也不刷新时：行的时间文案（按设备本地日）
   * 会把昨天的行显示成只有时分、被读成今天，日期上限（按北京日）则会滞留在昨
   * 天、挡住当天日志。到点两样一起重排并续上下一个日界。
   */
  scheduleRollover() {
    this.clearRollover();
    this.rolloverTimer = setTimeout(() => {
      this.rolloverTimer = 0;
      this.setData({
        maxDate: shanghaiToday(),
        ...(this.data.rows.length
          ? { rows: this.decorate(this.data.rows) }
          : {}),
      });
      this.scheduleRollover();
    }, msUntilNextRollover());
  },
  clearRollover() {
    if (!this.rolloverTimer) return;
    clearTimeout(this.rolloverTimer);
    this.rolloverTimer = 0;
  },
  onRetry() {
    void this.reload();
  },
  onPullDownRefresh() {
    // 手动刷新时连筛选项一起重取，新出现的操作码才会进到面板里
    this.setData({ facetsLoaded: false });
    void this.reload().then(() => wx.stopPullDownRefresh());
  },
  onReachBottom() {
    // reload 在途时 page/hasMore 仍属于旧列表，此时翻页会把旧条件的第 N 页接到
    // 新的第 0 页后面（代次相同，挡不住），必须等 reload 落地
    if (this.data.loading || !this.data.hasMore || this.data.loadingMore) return;
    void this.loadMore();
  },
  noop() {},

  // —— 搜索与结果 chips ——
  onKeywordInput(event: WechatMiniprogram.Input) {
    this.setData({ keyword: event.detail.value });
  },
  onSearchConfirm() {
    const search = this.data.keyword.trim();
    if (search === this.data.search) return;
    this.setData({ search });
    this.applyFilters();
  },
  onResultTap(event: WechatMiniprogram.TouchEvent) {
    const value = String(event.currentTarget.dataset.value ?? "");
    if (value === this.data.result) return;
    this.setData({ result: value });
    this.applyFilters();
  },

  // —— 更多筛选面板 ——
  onOpenFilters() {
    this.setData({
      filterVisible: true,
      // 页面一直停在前台跨过北京零点时 onShow 不会再触发，这里补算一次，
      // 否则两个日期选择器都还卡在昨天，今天的日志选不了
      maxDate: shanghaiToday(),
      draftAction: this.data.action,
      draftActionIndex: this.optionIndex(
        this.data.actionOptions,
        this.data.action,
      ),
      draftResourceType: this.data.resourceType,
      draftResourceIndex: this.optionIndex(
        this.data.resourceOptions,
        this.data.resourceType,
      ),
      draftFrom: this.data.from,
      draftTo: this.data.to,
    });
  },
  onCloseFilters() {
    this.setData({ filterVisible: false });
  },
  optionIndex(options: AuditFacetOption[], value: string): number {
    const index = options.findIndex((option) => option.value === value);
    return index >= 0 ? index : 0;
  },
  onDraftAction(event: WechatMiniprogram.PickerChange) {
    const index = Number(event.detail.value);
    this.setData({
      draftActionIndex: index,
      draftAction: this.data.actionOptions[index]?.value ?? "",
    });
  },
  onDraftResource(event: WechatMiniprogram.PickerChange) {
    const index = Number(event.detail.value);
    this.setData({
      draftResourceIndex: index,
      draftResourceType: this.data.resourceOptions[index]?.value ?? "",
    });
  },
  onDraftFrom(event: WechatMiniprogram.PickerChange) {
    this.setData({ draftFrom: String(event.detail.value) });
  },
  onDraftTo(event: WechatMiniprogram.PickerChange) {
    this.setData({ draftTo: String(event.detail.value) });
  },
  onClearFrom() {
    this.setData({ draftFrom: "" });
  },
  onClearTo() {
    this.setData({ draftTo: "" });
  },
  onResetFilters() {
    this.setData({
      draftAction: "",
      draftActionIndex: 0,
      draftResourceType: "",
      draftResourceIndex: 0,
      draftFrom: "",
      draftTo: "",
    });
  },
  onApplyFilters() {
    this.setData({
      action: this.data.draftAction,
      resourceType: this.data.draftResourceType,
      from: this.data.draftFrom,
      to: this.data.draftTo,
      filterVisible: false,
    });
    this.applyFilters();
  },
  /** 条件变化后统一重算角标并回到第一页 */
  applyFilters() {
    this.setData({
      filterCount: auditFilterCount(this.data),
      filtersActive: Boolean(
        this.data.search ||
          this.data.action ||
          this.data.resourceType ||
          this.data.result ||
          this.data.from ||
          this.data.to,
      ),
    });
    void this.reload();
  },
  currentFilters() {
    return {
      search: this.data.search || undefined,
      action: this.data.action || undefined,
      resourceType: this.data.resourceType || undefined,
      result: this.data.result || undefined,
      from: this.data.from || undefined,
      to: this.data.to || undefined,
    };
  },

  // —— 详情 ——
  onOpenDetail(event: WechatMiniprogram.TouchEvent) {
    const index = Number(event.currentTarget.dataset.index);
    const row = this.data.rows[index];
    if (!row) return;
    this.setData({
      detailVisible: true,
      detailTitle: row.actionLabel,
      detailItems: auditDetailItems(row),
      detailMetadata: formatAuditMetadata(row.metadata),
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

  decorate(rows: AuditRow[]): Row[] {
    return rows.map((row) => ({
      ...row,
      timeText: formatAuditTime(row.createdAt),
      failed: row.result !== "SUCCESS",
    }));
  },
  async reload() {
    const seq = ++this.reloadSeq;
    // 分页状态一并清空：在途的翻页属于旧条件（稍后被代次挡掉），而残留的
    // page/hasMore 会让 onReachBottom 拿旧页码去翻新列表
    this.setData({
      loading: true,
      loadError: "",
      loadingMore: false,
      page: 0,
      hasMore: false,
    });
    try {
      const result = await listAuditLogs({
        ...this.currentFilters(),
        page: 0,
        pageSize: PAGE_SIZE,
        // 筛选项与当前条件无关，只在首次加载时取一次
        withFacets: !this.data.facetsLoaded,
      });
      if (seq !== this.reloadSeq) return;
      this.setData({
        loading: false,
        rows: this.decorate(result.rows),
        page: 0,
        total: result.total,
        hasMore: (result.page + 1) * result.pageSize < result.total,
      });
      if (result.facets) this.applyFacets(result.facets);
    } catch (error) {
      if (seq !== this.reloadSeq) return;
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
  applyFacets(facets: AuditFacets) {
    const data = this.data;
    // 面板开着时下拉刷新的 facets 可能正好落地：草稿里选中的值也要留在选项里，
    // 否则 picker 显示的是一个值、点「应用」提交的是另一个
    const draftOf = (value: string) => (data.filterVisible ? value : "");
    const actionOptions = keepActiveOption(
      keepActiveOption(
        [ALL_OPTION, ...facets.actionOptions],
        data.actionOptions,
        data.action,
      ),
      data.actionOptions,
      draftOf(data.draftAction),
    );
    const resourceOptions = keepActiveOption(
      keepActiveOption(
        [ALL_OPTION, ...facets.resourceTypeOptions],
        data.resourceOptions,
        data.resourceType,
      ),
      data.resourceOptions,
      draftOf(data.draftResourceType),
    );
    this.setData({
      facetsLoaded: true,
      actionOptions,
      resourceOptions,
      // 库里一条日志都没有时 facets 为空，结果 chips 回落到默认两项
      resultOptions: keepActiveOption(
        facets.resultOptions.length
          ? [ALL_OPTION, ...facets.resultOptions]
          : DEFAULT_RESULT_OPTIONS,
        data.resultOptions,
        data.result,
      ),
      // 选项列表换了，picker 的下标必须跟着新列表重算
      draftActionIndex: this.optionIndex(actionOptions, data.draftAction),
      draftResourceIndex: this.optionIndex(
        resourceOptions,
        data.draftResourceType,
      ),
    });
  },
  async loadMore() {
    const seq = this.reloadSeq;
    const nextPage = this.data.page + 1;
    this.setData({ loadingMore: true });
    try {
      const result = await listAuditLogs({
        ...this.currentFilters(),
        page: nextPage,
        pageSize: PAGE_SIZE,
      });
      // 期间换过筛选条件：这页属于旧条件，接到新列表后面就是串数据
      if (seq !== this.reloadSeq) return;
      this.setData({
        loadingMore: false,
        // 已有行一并重算：页面跨过零点后，旧行的「只有时分」会被误读成今天，
        // 且与新一页的「月-日 时分」混在一起（decorate 幂等，setData 本就整份下发）
        rows: [...this.decorate(this.data.rows), ...this.decorate(result.rows)],
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
