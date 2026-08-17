import { ensureLoggedIn } from "../../lib/auth";
import { ensureBadgeSync } from "../../lib/badge";
import { listProjects, listRequests, type ServiceRequestSummary } from "../../lib/api";
import {
  REQUEST_STATUS_LABELS,
  REQUEST_STATUS_TONES,
  formatRelative,
  type RequestStatusValue,
} from "../../lib/format";

const STATUS_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "", label: "全部" },
  { value: "PENDING", label: "待处理" },
  { value: "IN_PROGRESS", label: "处理中" },
  { value: "WAITING_CUSTOMER", label: "等待客户" },
  { value: "RESOLVED", label: "已解决" },
  { value: "CLOSED", label: "已关闭" },
];

type Row = ServiceRequestSummary & {
  statusLabel: string;
  statusTone: string;
  updatedText: string;
};

Page({
  data: {
    projects: [] as Array<{ id: string; title: string }>,
    projectIndex: 0,
    projectFilterId: "",
    statusOptions: STATUS_OPTIONS,
    statusIndex: 0,
    keyword: "",
    rows: [] as Row[],
    loading: true,
    loadingMore: false,
    loadError: "",
    hasMore: false,
    nextOffset: 0,
    initializedFromProject: false,
  },
  onLoad(query: Record<string, string | undefined>) {
    this.setData({
      initializedFromProject: Boolean(query.projectId),
      projectFilterId: query.projectId ?? "",
    });
  },
  onShow() {
    if (!ensureLoggedIn()) return;
    ensureBadgeSync();
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
        .filter((project) => project.customerRequestsEnabled !== false)
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
  onKeywordInput(event: WechatMiniprogram.Input) {
    this.setData({ keyword: event.detail.value });
  },
  onSearchConfirm() {
    void this.reload();
  },
  onNewRequest() {
    wx.navigateTo({ url: "/pages/request-new/page" });
  },
  onOpenRequest(event: WechatMiniprogram.TouchEvent) {
    const requestId = event.currentTarget.dataset.id as string;
    wx.navigateTo({ url: `/pages/request-detail/page?id=${requestId}` });
  },
  async reload() {
    this.setData({ loading: true, loadError: "" });
    try {
      const result = await listRequests({
        projectId: this.data.projectFilterId || undefined,
        status:
          STATUS_OPTIONS[this.data.statusIndex]?.value || undefined,
        q: this.data.keyword.trim() || undefined,
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
          STATUS_OPTIONS[this.data.statusIndex]?.value || undefined,
        q: this.data.keyword.trim() || undefined,
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
      statusLabel:
        REQUEST_STATUS_LABELS[request.status as RequestStatusValue] ??
        request.status,
      statusTone:
        REQUEST_STATUS_TONES[request.status as RequestStatusValue] ??
        "neutral",
      updatedText: formatRelative(request.updatedAt),
    }));
  },
});
