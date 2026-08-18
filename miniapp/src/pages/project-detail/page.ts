import { ensureLoggedIn } from "../../lib/auth";
import { ensureBadgeSync } from "../../lib/badge";
import {
  getProject,
  markProjectScopeNotificationsRead,
  type ProjectDetailResponse,
  listMilestones,
  listProjectUpdates,
  listProjectRequests,
  downloadAttachment,
  type ProjectSummary,
  type Milestone,
  type ProjectUpdate,
  type ServiceRequestSummary,
  type AttachmentMeta,
} from "../../lib/api";
import {
  PROJECT_STATUS_LABELS,
  PROJECT_STATUS_TONES,
  REQUEST_STATUS_LABELS,
  REQUEST_STATUS_TONES,
  fileExtLabel,
  formatDateTime,
  formatFileSize,
  formatRelative,
  htmlToText,
  extractInlineImages,
  type ProjectStatusValue,
  type RequestStatusValue,
} from "../../lib/format";

type TabKey = "overview" | "milestones" | "updates" | "requests" | "files";

// 展示层视图：时间字段已格式化为字符串，不再与 API 原始类型混用
// 详情接口不返回列表 summary 的 _count/progressDetails，
// 计数一律用响应自带数组（updates/milestones）+ 预取的工单数
type ProjectDetailView = Omit<
  ProjectDetailResponse,
  "createdAt" | "updatedAt" | "startDate" | "endDate"
> & {
  createdAt: string;
  updatedAt: string;
  startDate: string | null;
  endDate: string | null;
};

type ViewFile = AttachmentMeta & { ext: string; sizeText: string };

type ViewRequest = ServiceRequestSummary & {
  statusLabel: string;
  statusTone: string;
  updatedText: string;
};

type ViewUpdate = {
  id: string;
  title: string;
  body: string;
  bodyText: string;
  imageCount: number;
  commentCount: number;
  authorName: string;
  timeText: string;
};

Page({
  data: {
    projectId: "",
    loading: true,
    loadError: "",
    project: null as ProjectDetailView | null,
    statusLabel: "",
    statusTone: "neutral",
    loadErrorTitle: "加载失败",
    canRetry: true,
    tabs: [] as Array<{ key: TabKey; label: string }>,
    activeTab: "overview" as TabKey,
    // 里程碑（骨架先行，避免先闪「暂无」）
    milestones: [] as Array<
      Milestone & { startDateText: string; endDateText: string }
    >,
    milestoneProgress: 0,
    milestonesLoading: false,
    // 动态
    updates: [] as ViewUpdate[],
    updatesLoading: false,
    // 服务请求（tab 内嵌列表）
    requests: [] as ViewRequest[],
    requestsLoading: false,
    requestCount: 0,
    // 文件
    files: [] as ViewFile[],
  },
  milestonesLoaded: false,
  updatesLoaded: false,
  requestsLoaded: false,

  initialTab: "",
  onLoad(query: Record<string, string | undefined>) {
    this.setData({ projectId: query.id ?? "" });
    this.initialTab = query.tab ?? "";
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
    const projectId = this.data.projectId;
    if (!projectId) {
      this.setData({
        loading: false,
        canRetry: false,
        loadError: "缺少项目参数，请从项目列表进入",
      });
      return;
    }
    this.milestonesLoaded = false;
    this.updatesLoaded = false;
    this.requestsLoaded = false;
    this.setData({ loading: true, loadError: "", requestCount: 0 });
    try {
      const project = await getProject(projectId);
      const tabs: Array<{ key: TabKey; label: string }> = [
        { key: "overview", label: "概览" },
      ];
      if (project.showMilestones !== false) {
        tabs.push({ key: "milestones", label: "里程碑" });
      }
      if (project.customerUpdatesEnabled !== false) {
        tabs.push({ key: "updates", label: "项目动态" });
      }
      if (project.customerRequestsEnabled !== false) {
        tabs.push({ key: "requests", label: "服务请求" });
      }
      if (project.customerFilesEnabled !== false) {
        tabs.push({ key: "files", label: "文件" });
      }
      // 详情无 _count：预取该项目工单（同时预热服务请求 tab）
      void listProjectRequests(projectId)
        .then((requests) => {
          this.requestsLoaded = true;
          this.setData({
            requests: requests.slice(0, 20).map((request) => ({
              ...request,
              statusLabel:
                REQUEST_STATUS_LABELS[request.status as RequestStatusValue] ??
                request.status,
              statusTone:
                REQUEST_STATUS_TONES[request.status as RequestStatusValue] ??
                "neutral",
              updatedText: formatRelative(request.updatedAt),
            })),
            requestCount: requests.length,
          });
        })
        .catch(() => undefined);
      this.setData({
        loading: false,
        project: {
          ...project,
          startDate: project.startDate ? project.startDate.slice(0, 10) : null,
          endDate: project.endDate ? project.endDate.slice(0, 10) : null,
          createdAt: formatDateTime(project.createdAt),
          updatedAt: formatRelative(project.updatedAt),
        },
        statusLabel:
          PROJECT_STATUS_LABELS[project.status as ProjectStatusValue] ??
          project.status,
        statusTone:
          PROJECT_STATUS_TONES[project.status as ProjectStatusValue] ??
          "neutral",
        tabs,
        // 消息跳转可指定目标 tab（如动态/里程碑/文件），非法值回退概览
        activeTab:
          this.data.activeTab ||
          (tabs.some((tab) => tab.key === this.initialTab)
            ? (this.initialTab as TabKey)
            : "overview"),
        files: (project.attachments ?? []).map((att) => ({
          ...att,
          ext: fileExtLabel(att.mimeType, att.originalName),
          sizeText: formatFileSize(att.size),
        })),
      });
      wx.setNavigationBarTitle({ title: project.title });
      const target = this.data.activeTab;
      if (target === "milestones" && !this.milestonesLoaded) {
        void this.loadMilestones();
      }
      if (target === "updates" && !this.updatesLoaded) {
        void this.loadUpdates();
      }
      this.markScopeRead(target);
    } catch (error) {
      const denied =
        error instanceof Error &&
        (error as { status?: number }).status === 404;
      this.setData({
        loading: false,
        loadError: denied
          ? "当前账号无权查看此内容"
          : error instanceof Error
            ? error.message
            : "加载失败，请下拉重试",
        loadErrorTitle: denied ? "无权查看" : "加载失败",
        canRetry: !denied,
      });
    }
  },
  onSwitchTab(event: WechatMiniprogram.TouchEvent) {
    const key = event.currentTarget.dataset.key as TabKey;
    this.setData({ activeTab: key });
    this.markScopeRead(key);
    if (key === "milestones" && !this.milestonesLoaded) {
      void this.loadMilestones();
    }
    if (key === "updates" && !this.updatesLoaded) {
      void this.loadUpdates();
    }
    if (key === "requests" && !this.requestsLoaded) {
      void this.loadRequests();
    }
  },
  /** 对齐 Web project-tabs：切到某 tab 即清该 scope 的未读通知（幂等） */
  markScopeRead(tab: TabKey) {
    const projectId = this.data.projectId;
    if (!projectId) return;
    const scopeMap: Partial<Record<TabKey, "overview" | "updates" | "milestones" | "files">> = {
      overview: "overview",
      updates: "updates",
      milestones: "milestones",
      files: "files",
    };
    const scope = scopeMap[tab];
    if (!scope) return; // 服务请求 tab 的通知在工单详情内清理
    void markProjectScopeNotificationsRead(projectId, scope)
      .then(() => {
        ensureBadgeSync();
      })
      .catch(() => undefined);
  },

  async loadMilestones() {
    const projectId = this.data.projectId;
    if (!projectId) return;
    this.setData({ milestonesLoading: true });
    try {
      const result = await listMilestones(projectId);
      this.milestonesLoaded = true;
      this.setData({
        milestonesLoading: false,
        milestones: result.milestones.map((milestone) => ({
          ...milestone,
          startDateText: formatDateTime(milestone.startDate).slice(0, 10),
          endDateText: formatDateTime(milestone.endDate).slice(0, 10),
        })),
        milestoneProgress: result.progress?.percentage ?? 0,
      });
    } catch {
      this.milestonesLoaded = true;
      this.setData({ milestonesLoading: false });
      wx.showToast({ title: "里程碑加载失败", icon: "none" });
    }
  },
  async loadUpdates() {
    const projectId = this.data.projectId;
    if (!projectId) return;
    this.setData({ updatesLoading: true });
    try {
      const updates = await listProjectUpdates(projectId);
      this.updatesLoaded = true;
      this.setData({
        updatesLoading: false,
        updates: updates.map((update: ProjectUpdate) => {
          const { html, images } = extractInlineImages(update.body);
          return {
            id: update.id,
            title: update.title,
            body: html,
            bodyText: htmlToText(html).slice(0, 100),
            imageCount: images.length,
            commentCount: update.comments.length,
            authorName: update.author.name,
            timeText: formatRelative(update.createdAt),
          };
        }),
      });
    } catch {
      this.updatesLoaded = true;
      this.setData({ updatesLoading: false });
      wx.showToast({ title: "项目动态加载失败", icon: "none" });
    }
  },
  async loadRequests() {
    const projectId = this.data.projectId;
    if (!projectId) return;
    this.setData({ requestsLoading: true });
    try {
      const requests = await listProjectRequests(projectId);
      this.requestsLoaded = true;
      this.setData({
        requestsLoading: false,
        requestCount: requests.length,
        requests: requests.slice(0, 20).map((request) => ({
          ...request,
          statusLabel:
            REQUEST_STATUS_LABELS[request.status as RequestStatusValue] ??
            request.status,
          statusTone:
            REQUEST_STATUS_TONES[request.status as RequestStatusValue] ??
            "neutral",
          updatedText: formatRelative(request.updatedAt),
        })),
      });
    } catch {
      this.requestsLoaded = true;
      this.setData({ requestsLoading: false });
      wx.showToast({ title: "工单加载失败", icon: "none" });
    }
  },
  onOpenUpdate(event: WechatMiniprogram.TouchEvent) {
    const index = Number(event.currentTarget.dataset.index);
    const update = this.data.updates[index];
    if (!update) return;
    wx.navigateTo({
      url: `/pages/update-detail/page?projectId=${this.data.projectId}&updateId=${update.id}`,
    });
  },
  onNewRequest() {
    wx.navigateTo({
      url: `/pages/request-new/page?projectId=${this.data.projectId}`,
    });
  },
  onOpenRequest(event: WechatMiniprogram.TouchEvent) {
    const requestId = event.currentTarget.dataset.id as string;
    wx.navigateTo({ url: `/pages/request-detail/page?id=${requestId}` });
  },
  async onOpenFile(event: WechatMiniprogram.TouchEvent) {
    const fileId = event.currentTarget.dataset.id as string;
    wx.showLoading({ title: "下载文件" });
    try {
      const localPath = await downloadAttachment(fileId);
      wx.hideLoading();
      await wx.openDocument({
        filePath: localPath,
        showMenu: true,
        fail: () => {
          wx.showToast({
            title: "微信暂不支持预览该格式，可在电脑端查看",
            icon: "none",
            duration: 2500,
          });
        },
      });
    } catch (error) {
      wx.hideLoading();
      wx.showToast({
        title: error instanceof Error ? error.message : "下载失败",
        icon: "none",
      });
    }
  },
});
