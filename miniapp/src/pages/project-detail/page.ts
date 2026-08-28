import { cancelPendingActivate, ensureLoggedIn, fetchMeCached, projectDeliveryCaps, type MiniappMe, type ProjectDeliveryCaps } from "../../lib/auth";
import { ensureBadgeSync } from "../../lib/badge";
import { eventSync } from "../../lib/events";
import {
  getProject,
  markProjectScopeNotificationsRead,
  updateProjectStage,
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
  uploadAttachment,
  setAttachmentProjectPin,
} from "../../lib/api";
import { pickAttachments } from "../../lib/pick-files";
import {
  PROJECT_STATUS_LABELS,
  PROJECT_STATUS_TONES,
  MILESTONE_STATUS_LABELS,
  MILESTONE_STATUS_TONES,
  requestStatusLabel,
  REQUEST_STATUS_TONES,
  isTextAttachment,
  type MilestoneStatusValue,
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

type ViewFile = AttachmentMeta & {
  ext: string;
  sizeText: string;
  displayName: string;
  note: string;
  isText: boolean;
  sourceLabel: string;
  pinned: boolean;
};

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

const SOURCE_LABELS: Record<string, string> = {
  PROJECT: "项目文件",
  REQUEST: "工单沟通",
  UPDATE: "进度动态",
  MILESTONE: "里程碑",
};

Page({
  data: {
    projectId: "",
    isStaff: false,
    loading: true,
    loadError: "",
    project: null as ProjectDetailView | null,
    statusLabel: "",
    statusTone: "neutral",
    loadErrorTitle: "加载失败",
    canRetry: true,
    tabs: [] as Array<{ key: TabKey; label: string }>,
    activeTab: "overview" as TabKey,
    // 右下角悬浮新增按钮的动作（跟随当前 tab 与权限；无权时为空即不渲染）
    showMilestoneStat: true,
    showUpdateStat: true,
    showRequestStat: true,
    fabAction: "" as "" | "milestone" | "update" | "file" | "request",
    uploadingFile: false,
    // 阶段编辑：原来用 wx.showModal(editable)，原生框既控制不了 placeholder 排版
    // 也和整体风格不统一，改成页面自有面板
    stageVisible: false,
    stageDraft: "",
    stageSaving: false,
    // 文件来源筛选：项目文件（手动上传）/ 来自沟通（工单聊天、动态里收录进来的）
    fileSource: "ALL" as "ALL" | "PROJECT" | "PINNED",
    fileSourceOptions: [
      { value: "ALL", label: "全部" },
      { value: "PROJECT", label: "项目文件" },
      { value: "PINNED", label: "来自沟通" },
    ],
    allFiles: [] as ViewFile[],
    // 员工交付能力（客户恒为全 false）；据此渲染写操作入口
    caps: {
      canManageDelivery: false,
      canPublishUpdate: false,
      canComment: false,
      canEditSettings: false,
      canManageStaff: false,
      canUploadFile: false,
    } as ProjectDeliveryCaps,
    // 里程碑（骨架先行，避免先闪「暂无」）
    milestones: [] as Array<
      Milestone & {
        startDateText: string;
        endDateText: string;
        statusLabel: string;
        statusTone: string;
        descriptionText: string;
        imageCount: number;
        attachmentCount: number;
      }
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
  me: null as MiniappMe | null,
  milestonesLoaded: false,
  updatesLoaded: false,
  requestsLoaded: false,

  initialTab: "",
  // 必须在 onLoad 里 bind 后再注册/注销（与工单详情同一套约束）
  boundEventHandler: null as
    | ((
        events: Array<{
          type: string;
          projectId: string | null;
          payload?: Record<string, unknown>;
        }>,
      ) => void)
    | null,
  sseStarted: false,
  // 校验中挂起的 activate；onHide/onUnload 需取消
  pendingActivate: null as (() => void) | null,
  onLoad(query: Record<string, string | undefined>) {
    this.setData({ projectId: query.id ?? "" });
    this.initialTab = query.tab ?? "";
    this.boundEventHandler = (events) => this.onRealtimeEvents(events);
  },
  onShow() {
    // 必须存下同一个函数引用：cancelAuthWaiter 按引用取消，每次现造匿名箭头
    // 函数就取消不掉 —— 校验完成后会唤醒已隐藏页面的 activate，
    // eventSync 计数只增不减，最后连登出都清不干净
    const activate = () => this.activate();
    this.pendingActivate = activate;
    if (!ensureLoggedIn(activate)) return;
    this.activate();
  },
  activate() {
    this.pendingActivate = null;
    ensureBadgeSync();
    // 项目详情此前完全没有订阅实时事件：别人发动态/改里程碑，页面一直是旧的，
    // 只能下拉或重进才刷新。这里补上（角标已持有常驻连接，这里只是加监听）
    if (this.boundEventHandler) {
      eventSync.on(this.boundEventHandler);
    }
    eventSync.start();
    this.sseStarted = true;
    void this.load();
  },
  teardown() {
    if (this.pendingActivate) {
      cancelPendingActivate(this.pendingActivate);
      this.pendingActivate = null;
    }
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
  /** 只刷新受影响的那部分，避免别人一动就整页重拉 */
  onRealtimeEvents(
    events: Array<{
      type: string;
      projectId: string | null;
      payload?: Record<string, unknown>;
    }>,
  ) {
    const projectId = this.data.projectId;
    const mine = events.filter((event) => event.projectId === projectId);
    if (mine.length === 0) return;
    const changes = new Set(
      mine
        .map((event) => event.payload?.change)
        .filter((change): change is string => typeof change === "string"),
    );
    if (
      mine.some(
        (event) =>
          event.type === "PROJECT_UPDATE_CREATED" ||
          event.type === "UPDATE_COMMENT_CREATED",
      ) ||
      changes.has("PROJECT_UPDATE_UPDATED") ||
      changes.has("PROJECT_UPDATE_DELETED") ||
      changes.has("UPDATE_COMMENT_UPDATED") ||
      changes.has("UPDATE_COMMENT_DELETED")
    ) {
      this.updatesLoaded = false;
      void this.loadUpdates();
    }
    if (
      changes.has("MILESTONE_CREATED") ||
      changes.has("MILESTONE_UPDATED") ||
      changes.has("MILESTONE_DELETED")
    ) {
      this.milestonesLoaded = false;
      void this.loadMilestones();
    }
    if (
      mine.some(
        (event) =>
          event.type === "REQUEST_CREATED" ||
          event.type === "REQUEST_STATUS_CHANGED" ||
          event.type === "REQUEST_UPDATED" ||
          event.type === "REQUEST_ASSIGNED",
      )
    ) {
      this.requestsLoaded = false;
      void this.loadRequests();
    }
    // 阶段 / 设置 / 人员 / 文件变化没有独立加载器，走整页刷新
    if (
      changes.has("PROJECT_UPDATED") ||
      changes.has("PROJECT_STAGE_UPDATED") ||
      changes.has("PROJECT_STAFF_ADDED") ||
      changes.has("PROJECT_STAFF_UPDATED") ||
      changes.has("PROJECT_STAFF_REMOVED") ||
      changes.has("PROJECT_ATTACHMENT_UPLOADED")
    ) {
      void this.load();
    }
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
      // 身份先行：员工的 tab 可见性与状态文案都依赖角色
      try {
        this.me = await fetchMeCached();
        if (this.me.isStaff !== this.data.isStaff) {
          this.setData({ isStaff: this.me.isStaff });
        }
      } catch {
        // 拿不到身份按客户视角渲染
      }
      const staffView = this.data.isStaff;
      const project = await getProject(projectId);
      // 交付能力：据我在该项目的角色（project.staff）+ 平台管理员推导
      const caps =
        this.me && this.me.isStaff
          ? projectDeliveryCaps(this.me, project.staff)
          : {
              canManageDelivery: false,
              canPublishUpdate: false,
              canComment: false,
              canEditSettings: false,
              canManageStaff: false,
              canUploadFile: false,
            };
      // showMilestones / customerXxxEnabled 是「对客户」的展示开关；员工不受限
      const tabs: Array<{ key: TabKey; label: string }> = [
        { key: "overview", label: "概览" },
      ];
      const showMilestoneStat = staffView || project.showMilestones !== false;
      const showUpdateStat = staffView || project.customerUpdatesEnabled !== false;
      const showRequestStat = staffView || project.customerRequestsEnabled !== false;
      if (showMilestoneStat) {
        tabs.push({ key: "milestones", label: "里程碑" });
      }
      if (staffView || project.customerUpdatesEnabled !== false) {
        tabs.push({ key: "updates", label: "项目动态" });
      }
      if (staffView || project.customerRequestsEnabled !== false) {
        tabs.push({ key: "requests", label: "服务请求" });
      }
      if (staffView || project.customerFilesEnabled !== false) {
        tabs.push({ key: "files", label: "文件" });
      }
      // 详情无 _count：预取该项目工单（同时预热服务请求 tab）
      void listProjectRequests(projectId)
        .then((requests) => {
          this.requestsLoaded = true;
          this.setData({
            requests: requests.slice(0, 20).map((request) => ({
              ...request,
              statusLabel: requestStatusLabel(
                request.status,
                this.data.isStaff,
              ),
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
        caps,
        tabs,
        // 概览的统计格必须和 tab 一样跟随模块开关，否则关掉模块后
        // tab 没了、概览那一格还在
        showMilestoneStat,
        showUpdateStat,
        showRequestStat,
        fabAction: this.resolveFabAction(
          this.data.activeTab ||
            (tabs.some((tab) => tab.key === this.initialTab)
              ? (this.initialTab as TabKey)
              : "overview"),
          caps,
          staffView,
        ),
        // 消息跳转可指定目标 tab（如动态/里程碑/文件），非法值回退概览
        activeTab:
          this.data.activeTab ||
          (tabs.some((tab) => tab.key === this.initialTab)
            ? (this.initialTab as TabKey)
            : "overview"),
        allFiles: (project.attachments ?? [])
          // 对齐 Web：被内容风控撤回的附件不展示
          .filter((att) => att.contentRiskStatus !== "REVOKED")
          .map((att) => ({
            ...att,
            displayName: att.title || att.originalName,
            note: att.note || "",
            isText: isTextAttachment(att.mimeType),
            ext: fileExtLabel(att.mimeType, att.originalName),
            sizeText: formatFileSize(att.size),
            sourceLabel: SOURCE_LABELS[att.source ?? "PROJECT"] ?? "项目文件",
            pinned: Boolean(att.pinned),
          })),
      });
      this.applyFileSource();
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
    this.setData({
      activeTab: key,
      fabAction: this.resolveFabAction(key, this.data.caps, this.data.isStaff),
    });
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
        milestones: result.milestones.map((milestone) => {
          // 说明同样走 sanitizeMessageHtml，可能带 attachment:// 内嵌图；
          // rich-text 加载不了会渲染成裂图，先剥掉
          const { html, images } = extractInlineImages(
            milestone.description ?? "",
          );
          return {
          ...milestone,
          description: html,
          // 与动态一致：列表只给两行预览，全文进详情页
          descriptionText: htmlToText(html).slice(0, 100),
          imageCount: images.length,
          attachmentCount: (milestone.attachments ?? []).length,
          startDateText: formatDateTime(milestone.startDate).slice(0, 10),
          endDateText: formatDateTime(milestone.endDate).slice(0, 10),
          statusLabel:
            MILESTONE_STATUS_LABELS[milestone.status as MilestoneStatusValue] ??
            milestone.status,
          statusTone:
            MILESTONE_STATUS_TONES[milestone.status as MilestoneStatusValue] ??
            "neutral",
          };
        }),
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
          statusLabel: requestStatusLabel(request.status, this.data.isStaff),
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

  // —— 项目交付写操作（能力由 caps 控制，服务端最终裁决）——

  onNewUpdate() {
    wx.navigateTo({
      url: `/pages/update-edit/page?projectId=${this.data.projectId}&mode=create`,
    });
  },
  onNewMilestone() {
    wx.navigateTo({
      url: `/pages/milestone-edit/page?projectId=${this.data.projectId}&mode=create`,
    });
  },
  /** 悬浮按钮跟随当前 tab：里程碑 / 动态 / 文件，无权限则不渲染 */
  resolveFabAction(
    tab: TabKey,
    caps: ProjectDeliveryCaps,
    isStaff: boolean,
  ): "" | "milestone" | "update" | "file" | "request" {
    if (tab === "milestones" && caps.canManageDelivery) return "milestone";
    if (tab === "updates" && caps.canPublishUpdate) return "update";
    if (tab === "files" && caps.canUploadFile) return "file";
    // 新建服务请求是客户侧动作：员工在项目里不代客户开单
    if (tab === "requests" && !isStaff) return "request";
    return "";
  },
  onFabTap() {
    const action = this.data.fabAction;
    if (action === "milestone") this.onNewMilestone();
    else if (action === "update") this.onNewUpdate();
    else if (action === "file") void this.onUploadFile();
    else if (action === "request") this.onNewRequest();
  },
  async onUploadFile() {
    if (this.data.uploadingFile) return;
    const chosen = await pickAttachments(5);
    if (chosen.length === 0) return;
    this.setData({ uploadingFile: true });
    wx.showLoading({ title: "上传中", mask: true });
    let failed = 0;
    for (const file of chosen) {
      try {
        await uploadAttachment({
          filePath: file.localPath,
          fileName: file.fileName,
          projectId: this.data.projectId,
        });
      } catch {
        failed += 1;
      }
    }
    wx.hideLoading();
    this.setData({ uploadingFile: false });
    wx.showToast({
      title:
        failed === 0
          ? `已上传 ${chosen.length} 个文件`
          : `${failed} 个文件上传失败`,
      icon: failed === 0 ? "success" : "none",
    });
    await this.load();
  },
  /**
   * 与动态一致：列表只给两行预览，点击进详情页看全文。
   * 编辑/删除移到详情页，列表不再是「员工才点得动」的隐藏入口。
   */
  onOpenMilestone(event: WechatMiniprogram.TouchEvent) {
    const index = Number(event.currentTarget.dataset.index);
    const milestone = this.data.milestones[index];
    if (!milestone) return;
    wx.navigateTo({
      url: `/pages/milestone-detail/page?projectId=${this.data.projectId}&milestoneId=${milestone.id}`,
    });
  },
  applyFileSource() {
    const source = this.data.fileSource;
    this.setData({
      files: this.data.allFiles.filter((file) =>
        source === "ALL" ? true : source === "PINNED" ? file.pinned : !file.pinned,
      ),
    });
  },
  onFileSource(event: WechatMiniprogram.TouchEvent) {
    this.setData(
      {
        fileSource: event.currentTarget.dataset.value as
          | "ALL"
          | "PROJECT"
          | "PINNED",
      },
      () => this.applyFileSource(),
    );
  },
  /** 长按已收录的文件可移出项目文件（原始位置不受影响） */
  onLongPressProjectFile(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id ?? "");
    const pinned = event.currentTarget.dataset.pinned === true;
    if (!id || !pinned) return;
    wx.showActionSheet({
      itemList: ["从项目文件中移出"],
      success: (res) => {
        if (res.tapIndex !== 0) return;
        setAttachmentProjectPin(id, false)
          .then(() => {
            wx.showToast({ title: "已移出", icon: "success" });
            void this.load();
          })
          .catch((error: unknown) => {
            wx.showToast({
              title: error instanceof Error ? error.message : "移出失败",
              icon: "none",
            });
          });
      },
    });
  },
  onEditStage() {
    if (!this.data.caps.canManageDelivery) return;
    this.setData({
      stageVisible: true,
      stageDraft: this.data.project?.currentStage ?? "",
    });
  },
  onStageInput(event: WechatMiniprogram.Input) {
    this.setData({ stageDraft: event.detail.value });
  },
  onCloseStage() {
    if (this.data.stageSaving) return;
    this.setData({ stageVisible: false });
  },
  onClearStage() {
    this.setData({ stageDraft: "" });
  },
  async onSaveStage() {
    if (this.data.stageSaving) return;
    const next = this.data.stageDraft.trim();
    this.setData({ stageSaving: true });
    try {
      await updateProjectStage(this.data.projectId, next || null);
      wx.showToast({ title: "已更新阶段", icon: "success" });
      this.setData({ stageVisible: false });
      await this.load();
    } catch (error) {
      wx.showToast({
        title: error instanceof Error ? error.message : "更新失败",
        icon: "none",
      });
    } finally {
      this.setData({ stageSaving: false });
    }
  },
  noop() {},
  onOpenSettings() {
    if (!this.data.caps.canEditSettings) return;
    wx.navigateTo({
      url: `/pages/project-settings/page?projectId=${this.data.projectId}`,
    });
  },
  onOpenStaff() {
    if (!this.data.caps.canManageStaff) return;
    wx.navigateTo({
      url: `/pages/project-staff/page?projectId=${this.data.projectId}`,
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
    if (event.currentTarget.dataset.istext) {
      const name = (event.currentTarget.dataset.name as string) || "";
      wx.navigateTo({
        url: `/pages/attachment-text/page?id=${fileId}&name=${encodeURIComponent(name)}`,
      });
      return;
    }
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
