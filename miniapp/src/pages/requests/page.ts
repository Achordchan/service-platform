import { ensureLoggedIn, fetchMeCached } from "../../lib/auth";
import { ensureBadgeSync } from "../../lib/badge";
import { eventSync } from "../../lib/events";
import { listProjects, listRequests, type ServiceRequestSummary } from "../../lib/api";
import { topUpSubscribeQuota } from "../../lib/subscribe";
import {
  REQUEST_STATUS_TONES,
  formatRelative,
  requestStatusLabel,
  type RequestStatusValue,
} from "../../lib/format";

const STATUS_VALUES = [
  "",
  "PENDING",
  "IN_PROGRESS",
  "WAITING_CUSTOMER",
  "RESOLVED",
  "CLOSED",
] as const;

// 状态筛选文案按身份生成：员工看「等待客户」，客户看「等待您回复」
function statusOptionsFor(staffView: boolean) {
  return STATUS_VALUES.map((value) => ({
    value,
    label: value ? requestStatusLabel(value, staffView) : "全部",
  }));
}

type Row = ServiceRequestSummary & {
  statusLabel: string;
  statusTone: string;
  updatedText: string;
  projectTitle: string;
};

Page({
  data: {
    isStaff: false,
    projects: [] as Array<{ id: string; title: string }>,
    projectIndex: 0,
    projectFilterId: "",
    statusOptions: statusOptionsFor(false),
    statusIndex: 0,
    keyword: "",
    // 更多筛选（优先级 / 归档范围 / 仅我处理）——面板里编辑 draft，应用后落到这三个
    priority: "",
    archived: "EXCLUDE" as "EXCLUDE" | "ONLY" | "ALL",
    assignedToMe: false,
    filterCount: 0,
    filterVisible: false,
    draftPriority: "",
    draftArchived: "EXCLUDE" as "EXCLUDE" | "ONLY" | "ALL",
    draftAssignedToMe: false,
    priorityOptions: [
      { value: "", label: "全部" },
      { value: "URGENT", label: "紧急" },
      { value: "HIGH", label: "高" },
      { value: "NORMAL", label: "中" },
      { value: "LOW", label: "低" },
    ],
    archivedOptions: [
      { value: "EXCLUDE", label: "不含归档" },
      { value: "ONLY", label: "只看归档" },
      { value: "ALL", label: "全部" },
    ],
    rows: [] as Row[],
    loading: true,
    loadingMore: false,
    loadError: "",
    hasMore: false,
    nextOffset: 0,
    initializedFromProject: false,
  },
  boundEventHandler: null as
    | ((events: Array<{ type: string }>) => void)
    | null,
  sseStarted: false,
  onLoad(query: Record<string, string | undefined>) {
    this.setData({
      initializedFromProject: Boolean(query.projectId),
      projectFilterId: query.projectId ?? "",
    });
    this.boundEventHandler = (events) => this.onRealtimeEvents(events);
  },
  onShow() {
    if (!ensureLoggedIn(() => this.activate())) return;
    this.activate();
  },
  teardown() {
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
  /** 新工单/状态变化/换处理人都会改变列表，实时刷新 */
  onRealtimeEvents(events: Array<{ type: string }>) {
    if (
      events.some(
        (event) =>
          event.type === "REQUEST_CREATED" ||
          event.type === "REQUEST_STATUS_CHANGED" ||
          event.type === "REQUEST_ASSIGNED" ||
          event.type === "REQUEST_MESSAGE_CREATED" ||
          event.type === "REQUEST_UPDATED",
      )
    ) {
      void this.reload();
    }
  },
  async activate() {
    ensureBadgeSync();
    if (this.boundEventHandler) {
      eventSync.on(this.boundEventHandler);
    }
    eventSync.start();
    this.sseStarted = true;
    // 先确定身份再拉列表：状态文案/项目筛选范围/新建入口都依赖角色
    try {
      const me = await fetchMeCached();
      if (me.isStaff !== this.data.isStaff) {
        this.setData({
          isStaff: me.isStaff,
          statusOptions: statusOptionsFor(me.isStaff),
        });
      }
    } catch {
      // 身份获取失败按客户视角展示，不阻塞列表加载
    }
    if (this.data.projects.length === 0) {
      void this.loadProjects();
    }
    void this.reload();
  },
  onPullDownRefresh() {
    void this.reload().then(() => wx.stopPullDownRefresh());
  },
  onReachBottom() {
    if (!this.data.hasMore || this.data.loadingMore) return;
    void this.loadMore();
  },
  async loadProjects() {
    try {
      const projects = await listProjects();
      const options = projects
        // 员工可以看到关闭了「客户提单」的项目里的工单，筛选不设此门槛
        .filter(
          (project) =>
            this.data.isStaff || project.customerRequestsEnabled !== false,
        )
        .map((project) => ({ id: project.id, title: project.title }));
      const presetIndex = options.findIndex(
        (option) => option.id === this.data.projectFilterId,
      );
      this.setData({
        projects: [{ id: "", title: "全部项目" }, ...options],
        projectIndex: presetIndex >= 0 ? presetIndex + 1 : 0,
      });
    } catch {
      // 项目筛选加载失败不阻塞列表
    }
  },
  onProjectChange(event: WechatMiniprogram.PickerChange) {
    const index = Number(event.detail.value);
    const option = this.data.projects[index];
    this.setData({
      projectIndex: index,
      projectFilterId: option?.id ?? "",
    });
    void this.reload();
  },
  onStatusTap(event: WechatMiniprogram.TouchEvent) {
    const index = Number(event.currentTarget.dataset.index);
    this.setData({ statusIndex: index });
    void this.reload();
  },
  // —— 更多筛选面板 ——
  onOpenFilters() {
    this.setData({
      filterVisible: true,
      draftPriority: this.data.priority,
      draftArchived: this.data.archived,
      draftAssignedToMe: this.data.assignedToMe,
    });
  },
  onCloseFilters() {
    this.setData({ filterVisible: false });
  },
  noop() {},
  onDraftPriority(event: WechatMiniprogram.TouchEvent) {
    this.setData({ draftPriority: String(event.currentTarget.dataset.value) });
  },
  onDraftArchived(event: WechatMiniprogram.TouchEvent) {
    this.setData({
      draftArchived: event.currentTarget.dataset.value as
        | "EXCLUDE"
        | "ONLY"
        | "ALL",
    });
  },
  onDraftAssigned(event: WechatMiniprogram.SwitchChange) {
    this.setData({ draftAssignedToMe: event.detail.value });
  },
  onResetFilters() {
    this.setData({
      draftPriority: "",
      draftArchived: "EXCLUDE",
      draftAssignedToMe: false,
    });
  },
  onApplyFilters() {
    const priority = this.data.draftPriority;
    const archived = this.data.draftArchived;
    const assignedToMe = this.data.draftAssignedToMe;
    this.setData({
      priority,
      archived,
      assignedToMe,
      filterVisible: false,
      // 角标只数「偏离默认」的项，默认态不显示数字
      filterCount:
        (priority ? 1 : 0) +
        (archived === "EXCLUDE" ? 0 : 1) +
        (assignedToMe ? 1 : 0),
    });
    void this.reload();
  },
  onKeywordInput(event: WechatMiniprogram.Input) {
    this.setData({ keyword: event.detail.value });
  },
  onSearchConfirm() {
    void this.reload();
  },
  onNewRequest() {
    topUpSubscribeQuota();
    wx.navigateTo({ url: "/pages/request-new/page" });
  },
  onOpenRequest(event: WechatMiniprogram.TouchEvent) {
    // 列表点击是最高频的用户手势，用它给一次性订阅额度续命（已长期授权时无感）
    topUpSubscribeQuota();
    const requestId = event.currentTarget.dataset.id as string;
    wx.navigateTo({ url: `/pages/request-detail/page?id=${requestId}` });
  },
  async reload() {
    this.setData({ loading: true, loadError: "" });
    try {
      const result = await listRequests({
        projectId: this.data.projectFilterId || undefined,
        status:
          this.data.statusOptions[this.data.statusIndex]?.value || undefined,
        q: this.data.keyword.trim() || undefined,
        priority: this.data.priority || undefined,
        archived: this.data.archived,
        assignedToMe: this.data.isStaff && this.data.assignedToMe,
        limit: 20,
        offset: 0,
      });
      this.setData({
        loading: false,
        rows: this.decorate(result.requests),
        hasMore: result.nextOffset !== null,
        nextOffset: result.nextOffset ?? 0,
      });
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
      const result = await listRequests({
        projectId: this.data.projectFilterId || undefined,
        status:
          this.data.statusOptions[this.data.statusIndex]?.value || undefined,
        q: this.data.keyword.trim() || undefined,
        priority: this.data.priority || undefined,
        archived: this.data.archived,
        assignedToMe: this.data.isStaff && this.data.assignedToMe,
        limit: 20,
        offset: this.data.nextOffset,
      });
      this.setData({
        loadingMore: false,
        rows: [...this.data.rows, ...this.decorate(result.requests)],
        hasMore: result.nextOffset !== null,
        nextOffset: result.nextOffset ?? 0,
      });
    } catch {
      this.setData({ loadingMore: false });
      wx.showToast({ title: "加载更多失败", icon: "none" });
    }
  },
  decorate(requests: ServiceRequestSummary[]): Row[] {
    return requests.map((request) => ({
      ...request,
      statusLabel: requestStatusLabel(request.status, this.data.isStaff),
      statusTone:
        REQUEST_STATUS_TONES[request.status as RequestStatusValue] ??
        "neutral",
      updatedText: formatRelative(request.updatedAt),
      projectTitle: request.project?.title ?? "",
    }));
  },
});
