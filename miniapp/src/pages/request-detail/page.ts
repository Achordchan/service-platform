import {
  ensureLoggedIn,
  fetchMeCached,
  cancelPendingActivate,
  hasPermission,
  type MiniappMe,
} from "../../lib/auth";
import {
  assignRequest,
  changeRequestStatus,
  getRequest,
  listProjectStaff,
  replyRequest,
  uploadAttachment,
  downloadAttachment,
  markRequestNotificationsRead,
  type MessageVisibility,
  type ProjectStaffMember,
  type ServiceRequestDetail,
  type RequestMessage,
  changeRequestArchive,
  revokeRequestMessage,
  listSupportPlaybooks,
  sendSupportPlaybook,
  type SupportPlaybook,
  type SupportPlaybookSnapshot,
  setAttachmentProjectPin,
  reportRequestPresence,
} from "../../lib/api";
import type { DeliveryOverride } from "../../lib/delivery";
import { ensureBadgeSync } from "../../lib/badge";
import { eventSync } from "../../lib/events";
import { pickAttachments, previewLocalFile } from "../../lib/pick-files";
import {
  formatFileSize,
  isTextAttachment,
  requestStatusLabel,
  REQUEST_STATUS_TONES,
  REQUEST_PRIORITY_LABELS,
  escapeHtml,
  formatDateTime,
  htmlToText,
  genMutationKey,
  type RequestStatusValue,
  type RequestPriorityValue,
  extractInlineImages,
} from "../../lib/format";
import { ApiError } from "../../lib/request";
import {
  ensureSubscribeStateCached,
  topUpSubscribeQuota,
} from "../../lib/subscribe";

// 风控提示文案（对齐 web ContentRiskNotice）：
// - 平台管理员：不显示（最高权限，web 端 contentRiskNoticeEnabled 亦 && !isPlatformAdmin）
// - 其他员工：员工版（措辞更强，明确会被记录并通知平台管理员）
// - 客户：客户版
const RISK_NOTICE_CUSTOMER =
  "请勿发送联系方式或引导站外沟通、交易。平台无法保障站外沟通与交易安全，由此产生的风险和损失由相关方自行承担。";
const RISK_NOTICE_STAFF =
  "严禁向客户提供个人联系方式或引导站外沟通、交易。违规行为将被记录并立即通知平台管理员，由平台管理员进行后续处理。";

// 员工端状态机的前端镜像（服务端 request-state-machine 的可达状态，员工不能设 CLOSED）
const STAFF_STATUS_CHOICES: Record<string, RequestStatusValue[]> = {
  PENDING: ["IN_PROGRESS", "WAITING_CUSTOMER"],
  IN_PROGRESS: ["WAITING_CUSTOMER", "RESOLVED"],
  WAITING_CUSTOMER: ["IN_PROGRESS", "RESOLVED"],
  RESOLVED: ["IN_PROGRESS"],
  CLOSED: [],
};

type ViewMessage = RequestMessage & {
  authorName: string;
  timeText: string;
  isMine: boolean;
  isAdmin: boolean;
  isInternal: boolean;
  bodyText: string;
  previewText: string;
  revoked: boolean;
  revokedText: string;
  /** 处理指南消息：正文只有标题+摘要，卡片展示并可展开全文 */
  playbook: SupportPlaybookSnapshot | null;
  reviewing: boolean;
  replyPreview: string;
images: Array<{ id: string; name: string; note: string }>;
  files: Array<{
    id: string;
    name: string;
    size: string;
    note: string;
    isText: boolean;
  }>;
};

type AttachmentMetaLite = {
  id: string;
  originalName: string;
  title?: string | null;
  note?: string | null;
  mimeType: string;
  size: number;
  inline?: boolean;
  contentRiskStatus?: string | null;
};

/**
 * 引用/回复目标的预览文本（对齐 Web replyText）：
 * 「正文是否为纯附件占位」由服务端用过滤前的完整附件列表全等判定并下发，
 * 前端不做启发式猜测；命中占位时用幸存附件的当前标题重建。
 */
function attachmentAwarePreview(
  bodyText: string,
  attachments: Array<{
    originalName: string;
    title?: string | null;
    inline?: boolean;
    contentRiskStatus?: string | null;
  }>,
  isPlaceholder: boolean | undefined,
) {
  if (!isPlaceholder) return bodyText;
  const files = attachments.filter(
    (att) => !att.inline && att.contentRiskStatus !== "REVOKED",
  );
  if (files.length === 0) return "原消息附件已撤回";
  return `附件：${files
    .map((att) => att.title || att.originalName)
    .join("、")}`;
}

Page({
  data: {
    requestId: "",
    loading: true,
    loadError: "",
    request: null as ServiceRequestDetail | null,
    statusLabel: "",
    statusTone: "neutral",
    priorityLabel: "",
    assigneeText: "",
    // 风控提示文案（空串表示不显示，如平台管理员或插件未启用）
    riskNoticeText: "",
    loadErrorTitle: "加载失败",
    canRetry: true,
    messages: [] as ViewMessage[],
    // 员工能力（客户恒为 false，wxml 据此渲染后台操作）
    isStaff: false,
    staffCanReply: false,
    staffCanChangeStatus: false,
    staffCanAssign: false,
    staffClaimRequired: false,
    staffViewOnly: false,
    staffCanInternal: false,
    statusChoices: [] as Array<{ value: string; label: string }>,
    statusSubmitting: false,
    // 状态变更：选完先落待确认，看清会提醒谁再确认
    pendingStatus: null as { value: string; label: string } | null,
    statusScene: null as unknown,
    statusOverride: {} as DeliveryOverride,
    // 公开回复的提醒方式覆盖
    replyScene: null as unknown,
    replyOverride: {} as DeliveryOverride,
    // 归档 / 撤回 / 处理指南
    staffCanArchive: false,
    staffCanRevoke: false,
    isArchived: false,
    archiving: false,
    playbooks: [] as SupportPlaybook[],
    // 对方在线状态（员工看客户 / 客户看服务人员）
    counterpartOnline: false,
    counterpartClients: [] as string[],
    playbookDetail: null as
      | (SupportPlaybookSnapshot & { contentHtml: string })
      | null,
    // 处理指南选择面板（对齐 Web 的分类 tab + 关键词搜索，不用原生 ActionSheet）
    playbookPickerVisible: false,
    playbookLoading: false,
    playbookCategory: "ALL",
    playbookKeyword: "",
    playbookCategories: [
      { value: "ALL", label: "全部" },
      { value: "REMOTE", label: "远程协助" },
      { value: "DIAGNOSTIC", label: "故障诊断" },
      { value: "INFORMATION", label: "信息收集" },
    ],
    playbookRows: [] as SupportPlaybook[],
    // 指派面板（仅平台管理员）
    assignPanelVisible: false,
    assignChoices: [] as Array<{ userId: string; name: string; roleLabel: string; checked: boolean }>,
    assignSubmitting: false,
    // 回复状态
    replyText: "",
    internalMode: false,
    replyTarget: null as ViewMessage | null,
    replyFiles: [] as Array<{
      localPath: string;
      fileName: string;
      title: string;
      note: string;
    }>,
    sending: false,
    scrollTop: 0,
  },
  replyMutationKey: "",
  markReadTimer: null as ReturnType<typeof setTimeout> | null,
  // eventSync 以裸函数引用调用 listener（严格模式 this 为 undefined），
  // 必须在 onLoad 里 bind 后再注册/注销
  boundEventHandler: null as ((events: Array<{ type: string; serviceRequestId: string | null }>) => void) | null,
  myUserId: "",
  me: null as MiniappMe | null,
  // 项目人员按 projectId 缓存（详情刷新频繁，人员几乎不变）
  projectStaffCache: null as { projectId: string; staff: ProjectStaffMember[] } | null,
  // 校验中挂起的 activate；未真正启动 SSE 前不得 stop()（配平计数）
  pendingActivate: null as (() => void) | null,
  sseStarted: false,
  // 在线上报：与 Web 同一端点，client 固定为 MINIAPP
  presenceSessionId: "",
  presenceTimer: null as number | null,

  onLoad(query: Record<string, string | undefined>) {
    const requestId = query.id ?? "";
    this.setData({
      requestId,
      replyScene: requestId
        ? { scene: "REQUEST_PUBLIC_MESSAGE", requestId }
        : null,
    });
    this.replyMutationKey = genMutationKey();
    this.boundEventHandler = (events) => this.onRealtimeEvents(events);
  },
  onShow() {
    const activate = () => this.activate();
    this.pendingActivate = activate;
    if (!ensureLoggedIn(activate)) return;
    this.activate();
  },
  activate() {
    this.pendingActivate = null;
    // 订阅消息可直接冷启到本页，此时额度快照还没人写过；先补上，
    // 否则 onSend 的静默续额是空转（详情页没有顶部引导横幅）
    ensureSubscribeStateCached();
    void this.bootstrapAndLoad();
    // 活跃页面保持实时流：客服/客户回复即时刷新（SSE，PRD §19）
    if (this.boundEventHandler) {
      eventSync.on(this.boundEventHandler);
    }
    eventSync.start();
    this.sseStarted = true;
    this.startPresence();
  },
  /** 心跳周期比服务端 TTL（3 分钟）短一截，避免边界抖动导致在线状态闪断 */
  startPresence() {
    if (this.presenceTimer !== null || !this.data.requestId) return;
    this.presenceSessionId ||= `ma-${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 12)}`;
    this.beatPresence();
    this.presenceTimer = setInterval(
      () => this.beatPresence(),
      100_000,
    ) as unknown as number;
  },
  /** 单次心跳：顺带取回对方在线状态与来源端 */
  beatPresence() {
    if (!this.data.requestId || !this.presenceSessionId) return;
    void reportRequestPresence(
      this.data.requestId,
      "heartbeat",
      this.presenceSessionId,
    )
      .then((result) => {
        this.setData({
          counterpartOnline: result.counterpartOnline,
          counterpartClients: result.counterpartClients ?? [],
        });
      })
      .catch(() => {
        // 在线状态是辅助信息，弱网失败时保留上一次结果
      });
  },
  stopPresence() {
    if (this.presenceTimer !== null) {
      clearInterval(this.presenceTimer);
      this.presenceTimer = null;
    }
    if (this.presenceSessionId && this.data.requestId) {
      void reportRequestPresence(
        this.data.requestId,
        "leave",
        this.presenceSessionId,
      ).catch(() => undefined);
    }
  },
  /** 先确定身份（isMine 判定、员工能力推导都依赖），再加载详情 */
  async bootstrapAndLoad() {
    try {
      const me = await fetchMeCached();
      this.me = me;
      this.myUserId = me.user.id;
      if (me.isStaff !== this.data.isStaff) {
        this.setData({ isStaff: me.isStaff });
      }
    } catch {
      // 弱网拿不到身份时按客户视角渲染；消息归属由后续刷新纠正
    }
    await this.load();
  },
  teardown() {
    // 校验中挂起的 activate 需取消，避免隐藏后被唤醒启动 SSE；
    // 未真正 start() 则不得 stop()，否则会错减其他活跃页的计数
    if (this.pendingActivate) {
      cancelPendingActivate(this.pendingActivate);
      this.pendingActivate = null;
    }
    if (this.sseStarted) {
      this.sseStarted = false;
      if (this.boundEventHandler) {
        eventSync.off(this.boundEventHandler);
      }
      eventSync.stop();
    }
    if (this.markReadTimer) {
      clearTimeout(this.markReadTimer);
      this.markReadTimer = null;
    }
    this.stopPresence();
  },
  onHide() {
    this.teardown();
  },
  onUnload() {
    this.teardown();
  },
  onPullDownRefresh() {
    void this.load().then(() => wx.stopPullDownRefresh());
  },
  onRetry() {
    void this.load();
  },
  // 事件过滤：只关心当前工单的消息/状态变化（经 boundEventHandler 调用）
  onRealtimeEvents(
    events: Array<{
      type: string;
      serviceRequestId: string | null;
      payload?: Record<string, unknown>;
    }>,
  ) {
    const requestId = this.data.requestId;
    const matches = (event: {
      type: string;
      serviceRequestId: string | null;
      payload?: Record<string, unknown>;
    }) => {
      if (event.serviceRequestId !== requestId) {
        // NOTIFICATION_CREATED 事件的工单归属在 payload 里
        if (event.type !== "NOTIFICATION_CREATED") return false;
        const pid = event.payload?.serviceRequestId;
        return typeof pid === "string" && pid === requestId;
      }
      return (
        event.type === "REQUEST_MESSAGE_CREATED" ||
        event.type === "REQUEST_STATUS_CHANGED" ||
        event.type === "REQUEST_ASSIGNED" ||
        event.type === "REQUEST_UPDATED" ||
        event.type === "NOTIFICATION_CREATED" ||
        // 内容风控撤回/恢复：实时刷新才能立即显示「已被系统撤回」，无需手动下拉
        event.type === "CONTENT_RISK_REVIEW_UPDATED"
      );
    };
    // 对方上下线：事件只带 online，不带来自哪个端 → 补一次心跳拿权威状态。
    // 这条不触发整页 load，避免每次对方切页都重拉工单详情。
    if (
      events.some(
        (event) =>
          event.type === "REQUEST_PRESENCE_CHANGED" &&
          event.serviceRequestId === requestId,
      )
    ) {
      this.beatPresence();
    }
    if (events.some(matches)) {
      void this.load();
      // 我正在看这个工单：稍作防抖后把刚产生的通知标记已读并刷新角标
      this.scheduleMarkRead(250);
    }
  },
  /** 防抖标记该工单通知已读；失败静默（下次事件/进入再试） */
  scheduleMarkRead(delay = 0) {
    if (this.markReadTimer) clearTimeout(this.markReadTimer);
    this.markReadTimer = setTimeout(() => {
      this.markReadTimer = null;
      const requestId = this.data.requestId;
      if (!requestId) return;
      void markRequestNotificationsRead(requestId)
        .then(() => {
          ensureBadgeSync();
        })
        .catch(() => undefined);
    }, delay);
  },

  async load() {
    const requestId = this.data.requestId;
    if (!requestId) return;
    try {
      const request = await getRequest(requestId);
      const messages = request.messages.map((message) =>
        this.decorateMessage(message),
      );
      const decoratedRequest = {
        ...request,
        attachments: request.attachments
          // 对齐 Web：被内容风控撤回的附件不展示（连元信息一起隐藏）
          .filter((att) => att.contentRiskStatus !== "REVOKED")
          .map((att) => ({
            ...att,
            displayName: att.title || att.originalName,
            note: att.note || "",
            sizeText: formatFileSize(att.size),
            isText: isTextAttachment(att.mimeType),
          })),
      };
      const assigneeNames = (request.assignees ?? [])
        .map((item) => item.user.name)
        .filter(Boolean);
      // 风控提示：插件启用时才有意义；平台管理员隐藏、员工与客户文案不同（对齐 web）
      const riskNoticeText = !request.contentRiskUiEnabled
        ? ""
        : this.me?.isPlatformAdmin
          ? ""
          : this.data.isStaff
            ? RISK_NOTICE_STAFF
            : RISK_NOTICE_CUSTOMER;
      // 员工能力先于渲染算好，与详情同帧落地，避免底部操作区闪错
      const staffPatch = await this.deriveStaffCapabilities(request);
      this.setData({
        loading: false,
        loadError: "",
        request: decoratedRequest,
        statusLabel: requestStatusLabel(request.status, this.data.isStaff),
        statusTone:
          REQUEST_STATUS_TONES[request.status as RequestStatusValue] ??
          "neutral",
        priorityLabel:
          REQUEST_PRIORITY_LABELS[request.priority as RequestPriorityValue] ??
          request.priority,
        assigneeText:
          assigneeNames.length > 0
            ? assigneeNames.join("、")
            : request.assignee
              ? request.assignee.name
              : "待指派",
        riskNoticeText,
        messages,
        scrollTop: messages.length * 1000,
        ...staffPatch,
      });
      wx.setNavigationBarTitle({ title: request.number });
      // 对齐 Web：停留在工单详情时该工单的通知保持已读
      this.scheduleMarkRead();
    } catch (error) {
      const denied =
        error instanceof ApiError && (error.status === 403 || error.status === 404);
      this.setData({
        loading: false,
        loadError: denied
          ? "工单不存在或当前账号无权查看"
          : error instanceof Error
            ? error.message
            : "加载失败，请下拉重试",
        loadErrorTitle: denied ? "无法访问" : "加载失败",
        canRetry: !denied,
      });
    }
  },
  /**
   * 员工能力推导：与 Web 端 staff/requests/[requestId]/page.tsx 同口径——
   * hasRequestScope = 管理员 | 本项目项目经理 | 被分配人；
   * claimRequired = 非管理员 + 是项目成员 + 工单未分配 + 有回复权限（回复即自动认领）。
   * 服务端仍是最终裁决者，这里只决定「展示哪些操作」。
   * 返回 setData 补丁（客户返回空对象），由 load() 与详情同帧渲染。
   */
  async deriveStaffCapabilities(request: ServiceRequestDetail) {
    const me = this.me;
    if (!me || !me.isStaff) return {};
    let projectStaff: ProjectStaffMember[] = [];
    if (this.projectStaffCache?.projectId === request.projectId) {
      projectStaff = this.projectStaffCache.staff;
    } else {
      try {
        projectStaff = await listProjectStaff(request.projectId);
        this.projectStaffCache = { projectId: request.projectId, staff: projectStaff };
      } catch {
        // 人员列表拉取失败：按无项目分配处理（管理员能力不受影响）
      }
    }
    const assigneeIds = Array.from(
      new Set(
        [
          request.assignee?.id ?? null,
          ...(request.assignees ?? []).map((item) => item.userId),
        ].filter((value): value is string => Boolean(value)),
      ),
    );
    const currentAssignment = projectStaff.find(
      (member) => member.userId === this.myUserId,
    );
    const unassigned = assigneeIds.length === 0;
    const claimRequired = Boolean(
      !me.isPlatformAdmin &&
        currentAssignment &&
        unassigned &&
        hasPermission(me, "request.reply"),
    );
    const hasRequestScope =
      me.isPlatformAdmin ||
      currentAssignment?.role === "PROJECT_MANAGER" ||
      assigneeIds.includes(this.myUserId);
    const closed = request.status === "CLOSED";
    const archived = Boolean(
      (request as unknown as { archivedAt?: string | null }).archivedAt,
    );
    const canReply =
      !closed &&
      !archived &&
      ((hasRequestScope && hasPermission(me, "request.reply")) || claimRequired);
    const canChangeStatus =
      !archived &&
      hasRequestScope &&
      hasPermission(me, "request.change_status");
    const canInternal =
      !closed && !archived && hasRequestScope && hasPermission(me, "request.reply");
    const statusChoices = (STAFF_STATUS_CHOICES[request.status] ?? []).map(
      (value) => ({ value, label: requestStatusLabel(value, true) }),
    );
    return {
      staffCanReply: canReply,
      // 归档/恢复沿用 Web：与「变更状态」同一把权限
      staffCanArchive: hasRequestScope && hasPermission(me, "request.change_status"),
      // 撤回消息是平台管理员专属（服务端同样断言）
      staffCanRevoke: me.isPlatformAdmin,
      isArchived: archived,
      staffCanChangeStatus: canChangeStatus && statusChoices.length > 0,
      staffCanAssign: me.isPlatformAdmin && !archived && !closed,
      staffClaimRequired: claimRequired && !closed && !archived,
      staffViewOnly: !canReply,
      staffCanInternal: canInternal,
      statusChoices,
      // 权限收敛时不能停留在已失效的内部模式
      internalMode: this.data.internalMode && canInternal,
    };
  },

  // —— 员工操作：状态变更 ——

  onOpenStatusSheet() {
    const choices = this.data.statusChoices;
    if (choices.length === 0) return;
    wx.showActionSheet({
      itemList: choices.map((choice) => `改为${choice.label}`),
      success: (res) => {
        const choice = choices[res.tapIndex];
        if (!choice) return;
        // 原本点完直接生效，挂不住发送前提示；先落待确认卡片
        this.setData({
          pendingStatus: choice,
          statusScene: {
            scene: "REQUEST_STATUS",
            requestId: this.data.requestId,
            status: choice.value,
          },
          statusOverride: {},
        });
      },
    });
  },
  onStatusDeliveryChange(event: WechatMiniprogram.CustomEvent) {
    this.setData({
      statusOverride: (event.detail?.override ?? {}) as DeliveryOverride,
    });
  },
  onCancelStatusChange() {
    this.setData({
      pendingStatus: null,
      statusScene: null,
      statusOverride: {},
    });
  },
  onConfirmStatusChange() {
    const pending = this.data.pendingStatus;
    if (pending) void this.submitStatusChange(pending.value);
  },
  async submitStatusChange(status: string) {
    if (this.data.statusSubmitting) return;
    const override = this.data.statusOverride;
    this.setData({ statusSubmitting: true });
    try {
      await changeRequestStatus(
        this.data.requestId,
        status,
        Object.keys(override).length > 0 ? override : undefined,
      );
      wx.showToast({
        title: `已更新为${requestStatusLabel(status, true)}`,
        icon: "success",
      });
      // 覆盖是一次性的，不跨下一次操作沿用
      this.setData({
        pendingStatus: null,
        statusScene: null,
        statusOverride: {},
      });
      await this.load();
    } catch (error) {
      wx.showToast({
        title: error instanceof Error ? error.message : "状态更新失败",
        icon: "none",
      });
    } finally {
      this.setData({ statusSubmitting: false });
    }
  },

  // —— 员工操作：归档 / 恢复 ——

  async onToggleArchive() {
    if (this.data.archiving) return;
    const next = !this.data.isArchived;
    const confirmed = await new Promise<boolean>((resolve) => {
      wx.showModal({
        title: next ? "归档服务请求" : "恢复服务请求",
        content: next
          ? "归档后将不再出现在默认列表，也不能继续回复。"
          : "恢复后可继续处理该服务请求。",
        success: (res) => resolve(res.confirm),
        fail: () => resolve(false),
      });
    });
    if (!confirmed) return;
    this.setData({ archiving: true });
    try {
      await changeRequestArchive(this.data.requestId, next);
      wx.showToast({ title: next ? "已归档" : "已恢复", icon: "success" });
      await this.load();
    } catch (error) {
      wx.showToast({
        title: error instanceof Error ? error.message : "操作失败",
        icon: "none",
      });
    } finally {
      this.setData({ archiving: false });
    }
  },

  // —— 员工操作：撤回消息（仅平台管理员）——

  async revokeMessageById(messageId: string) {
    if (!this.data.staffCanRevoke || !messageId) return;
    const input = await new Promise<string | null>((resolve) => {
      wx.showModal({
        title: "撤回这条消息",
        editable: true,
        placeholderText: "填写撤回理由（对方可见，至少 2 字）",
        success: (res) =>
          resolve(res.confirm ? (res.content ?? "").trim() : null),
        fail: () => resolve(null),
      });
    });
    if (input === null) return;
    if (input.length < 2) {
      wx.showToast({ title: "请填写撤回理由", icon: "none" });
      return;
    }
    try {
      await revokeRequestMessage(this.data.requestId, messageId, input);
      wx.showToast({ title: "已撤回", icon: "success" });
      await this.load();
    } catch (error) {
      wx.showToast({
        title: error instanceof Error ? error.message : "撤回失败",
        icon: "none",
      });
    }
  },

  // —— 员工操作：处理指南 ——

  async onOpenPlaybooks() {
    this.setData({ playbookPickerVisible: true });
    if (this.data.playbooks.length > 0) {
      this.filterPlaybooks();
      return;
    }
    this.setData({ playbookLoading: true });
    try {
      const playbooks = await listSupportPlaybooks();
      this.setData({ playbooks, playbookLoading: false });
      this.filterPlaybooks();
    } catch {
      this.setData({ playbookLoading: false });
      wx.showToast({ title: "处理指南加载失败", icon: "none" });
    }
  },
  onClosePlaybooks() {
    this.setData({ playbookPickerVisible: false });
  },
  onPlaybookCategory(event: WechatMiniprogram.TouchEvent) {
    this.setData(
      { playbookCategory: String(event.currentTarget.dataset.value) },
      () => this.filterPlaybooks(),
    );
  },
  onPlaybookKeyword(event: WechatMiniprogram.Input) {
    this.setData({ playbookKeyword: event.detail.value }, () =>
      this.filterPlaybooks(),
    );
  },
  filterPlaybooks() {
    const category = this.data.playbookCategory;
    const keyword = this.data.playbookKeyword.trim().toLowerCase();
    this.setData({
      playbookRows: this.data.playbooks.filter((item) => {
        if (category !== "ALL" && item.category !== category) return false;
        if (!keyword) return true;
        return (
          item.title.toLowerCase().includes(keyword) ||
          item.summary.toLowerCase().includes(keyword)
        );
      }),
    });
  },
  onPreviewPlaybook(event: WechatMiniprogram.TouchEvent) {
    const key = String(event.currentTarget.dataset.key ?? "");
    const playbook = this.data.playbooks.find((item) => item.key === key);
    if (playbook) this.showPlaybookDetail(playbook);
  },
  onPickPlaybook(event: WechatMiniprogram.TouchEvent) {
    const key = String(event.currentTarget.dataset.key ?? "");
    const playbook = this.data.playbooks.find((item) => item.key === key);
    if (!playbook) return;
    this.setData({ playbookPickerVisible: false });
    void this.submitPlaybook(playbook);
  },
  async submitPlaybook(playbook: SupportPlaybook) {
    if (this.data.sending) return;
    this.setData({ sending: true });
    try {
      const override = this.data.replyOverride;
      await sendSupportPlaybook(
        this.data.requestId,
        playbook.key,
        Object.keys(override).length > 0 ? override : undefined,
      );
      wx.showToast({ title: "处理指南已发送", icon: "success" });
      this.setData({ replyOverride: {} });
      await this.load();
    } catch (error) {
      wx.showToast({
        title: error instanceof Error ? error.message : "发送失败",
        icon: "none",
      });
    } finally {
      this.setData({ sending: false });
    }
  },

  onOpenPlaybookDetail(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id ?? "");
    const message = this.data.messages.find((item) => item.id === id);
    if (message?.playbook) this.showPlaybookDetail(message.playbook);
  },
  /** content 是富文本且同样可能带 attachment:// 内嵌图，渲染前必须剥掉 */
  showPlaybookDetail(playbook: SupportPlaybookSnapshot) {
    this.setData({
      playbookDetail: {
        ...playbook,
        contentHtml: playbook.content
          ? extractInlineImages(playbook.content).html
          : "",
      },
    });
  },
  // 遮罩上吞掉冒泡与滚动穿透
  noop() {},
  onClosePlaybookDetail() {
    this.setData({ playbookDetail: null });
  },

  // —— 员工操作：指派（仅平台管理员）——

  onOpenAssignPanel() {
    const request = this.data.request;
    const me = this.me;
    if (!request || !me) return;
    const currentIds = new Set(
      [
        request.assignee?.id ?? null,
        ...(request.assignees ?? []).map((item) => item.userId),
      ].filter((value): value is string => Boolean(value)),
    );
    const staff = this.projectStaffCache?.staff ?? [];
    const choices = staff.map((member) => ({
      userId: member.userId,
      name: member.user.name,
      roleLabel: member.role === "PROJECT_MANAGER" ? "项目经理" : "技术人员",
      checked: currentIds.has(member.userId),
    }));
    // 管理员本人可以作为处理人（服务端允许平台管理员不在项目人员内）
    if (!choices.some((choice) => choice.userId === me.user.id)) {
      choices.unshift({
        userId: me.user.id,
        name: `${me.user.name}（我）`,
        roleLabel: "平台管理员",
        checked: currentIds.has(me.user.id),
      });
    }
    this.setData({ assignPanelVisible: true, assignChoices: choices });
  },
  onCloseAssignPanel() {
    if (this.data.assignSubmitting) return;
    this.setData({ assignPanelVisible: false });
  },
  onToggleAssignee(event: WechatMiniprogram.TouchEvent) {
    const userId = event.currentTarget.dataset.id as string;
    this.setData({
      assignChoices: this.data.assignChoices.map((choice) =>
        choice.userId === userId
          ? { ...choice, checked: !choice.checked }
          : choice,
      ),
    });
  },
  async onSubmitAssign() {
    if (this.data.assignSubmitting) return;
    const assigneeIds = this.data.assignChoices
      .filter((choice) => choice.checked)
      .map((choice) => choice.userId);
    this.setData({ assignSubmitting: true });
    try {
      await assignRequest(this.data.requestId, assigneeIds);
      wx.showToast({
        title: assigneeIds.length > 0 ? "处理人已更新" : "已取消分配",
        icon: "success",
      });
      this.setData({ assignPanelVisible: false });
      await this.load();
    } catch (error) {
      wx.showToast({
        title: error instanceof Error ? error.message : "分配失败",
        icon: "none",
      });
    } finally {
      this.setData({ assignSubmitting: false });
    }
  },

  // —— 员工操作：内部备注开关 ——

  onSetReplyMode(event: WechatMiniprogram.TouchEvent) {
    const internal = event.currentTarget.dataset.mode === "internal";
    if (internal && !this.data.staffCanInternal) return;
    // 引用的内部消息只能用内部备注回复（对齐服务端 validateReplyTarget）
    if (!internal && this.data.replyTarget?.isInternal) {
      wx.showToast({ title: "内部消息只能以内部备注回复", icon: "none" });
      return;
    }
    this.setData({ internalMode: internal });
  },

  decorateMessage(message: RequestMessage): ViewMessage {
    // 对齐 Web request-chat-thread：被内容风控撤回的附件（含标题/备注）不渲染
    const attachments: AttachmentMetaLite[] = (
      message.attachments ?? []
    ).filter((att) => att.contentRiskStatus !== "REVOKED");
    // 正文里的内嵌图片在 rich-text 里加载不出来（拿不到登录态）→ 必须先剥掉，
    // 否则气泡里就是一张裂图。图片本体已在下方附件区以可预览的方式列出。
    const { html: bodyHtml } = extractInlineImages(message.body);
    const bodyText = htmlToText(bodyHtml);
    return {
      ...message,
      body: bodyHtml,
      authorName: message.author?.name ?? "系统",
      timeText: formatDateTime(message.createdAt),
      isMine: message.authorId !== null && message.authorId === this.myUserId,
      // 对齐 Web：仅平台管理员消息加「管理员」标识
      isAdmin: message.author?.platformRole === "PLATFORM_ADMIN",
      // 内部备注仅员工可见（服务端已对客户过滤），气泡加内部标识与配色
      isInternal: message.visibility === "INTERNAL",
      bodyText,
      // 引用/回复目标的预览文本：纯附件占位正文优先显示附件当前标题（对齐 Web replyText）
      previewText: attachmentAwarePreview(
        bodyText,
        attachments,
        message.bodyIsAttachmentPlaceholder,
      ),
      // 处理指南消息用专门的卡片渲染（正文那两段与卡片重复，不再走 rich-text）
      playbook: message.supportPlaybook ?? null,
      revoked: message.contentRiskStatus === "REVOKED",
      // 文案对齐 Web：人工撤回带决策理由，自动撤回用通用原因
      revokedText:
        message.contentRiskStatus === "REVOKED"
          ? `该内容已被系统撤回：${
              message.contentRiskReason?.trim() ||
              "疑似包含联系方式或站外交易引导。"
            }`
          : "",
      reviewing: message.contentRiskStatus === "PENDING",
      replyPreview: message.replyTo
        ? `${message.replyTo.author?.name ?? ""}: ${attachmentAwarePreview(
            htmlToText(message.replyTo.body),
            message.replyTo.attachments ?? [],
            message.replyTo.bodyIsAttachmentPlaceholder,
          ).slice(0, 60)}`
        : "",
      images: attachments
        .filter((att) => att.mimeType.startsWith("image/"))
        .map((att) => ({
          id: att.id,
          name: att.title || att.originalName,
          note: att.note || "",
        })),
      files: attachments
        .filter((att) => !att.mimeType.startsWith("image/"))
        .map((att) => ({
          id: att.id,
          name: att.title || att.originalName,
          size: formatFileSize(att.size),
          note: att.note || "",
          isText: isTextAttachment(att.mimeType),
        })),
    };
  },

  // —— 回复 ——

  onReplyInput(event: WechatMiniprogram.TextareaInput) {
    this.setData({ replyText: event.detail.value });
  },
  onLongPressMessage(event: WechatMiniprogram.TouchEvent) {
    // 按消息 id 定位，避免下标错位；系统提示与已撤回内容无操作意义，直接忽略
    const id = event.currentTarget.dataset.id as string;
    const message = this.data.messages.find((item) => item.id === id);
    if (!message || message.isSystem || message.revoked) return;
    // 撤回是平台管理员专属，且系统消息不可撤
    const canRevoke = this.data.staffCanRevoke && !message.isSystem;
    const items = ["回复此消息", "复制文本", ...(canRevoke ? ["撤回此消息"] : [])];
    wx.showActionSheet({
      itemList: items,
      success: (res) => {
        if (res.tapIndex === 0) {
          if (message.isInternal && !this.data.staffCanInternal) {
            wx.showToast({ title: "暂无权限回复内部消息", icon: "none" });
            return;
          }
          this.setData({
            replyTarget: message,
            // 服务端约束：内部消息只能以内部备注回复，选中即切换模式
            internalMode: message.isInternal ? true : this.data.internalMode,
          });
        } else if (res.tapIndex === 1) {
          this.copyMessageText(message);
        } else if (res.tapIndex === 2 && canRevoke) {
          void this.revokeMessageById(message.id);
        }
      },
    });
  },
  copyMessageText(message: ViewMessage) {
    const text = message.bodyText.trim();
    if (!text) {
      wx.showToast({ title: "没有可复制的文本", icon: "none" });
      return;
    }
    // setClipboardData 成功会自带「已复制」系统提示，无需再 toast
    wx.setClipboardData({
      data: text,
      fail: () => wx.showToast({ title: "复制失败", icon: "none" }),
    });
  },
  onCancelReplyTarget() {
    this.setData({ replyTarget: null });
  },
  async onAddReplyFile() {
    if (this.data.replyFiles.length >= 5) {
      wx.showToast({ title: "最多 5 个附件", icon: "none" });
      return;
    }
    const chosen = await pickAttachments(5 - this.data.replyFiles.length);
    if (chosen.length === 0) return;
    this.setData({
      replyFiles: [
        ...this.data.replyFiles,
        // 标题默认用文件名，用户可改；备注选填
        ...chosen.map((file) => ({ ...file, title: file.fileName, note: "" })),
      ],
    });
  },
  onPreviewReplyFile(event: WechatMiniprogram.TouchEvent) {
    const index = Number(event.currentTarget.dataset.index);
    const file = this.data.replyFiles[index];
    if (file) previewLocalFile(file);
  },
  onReplyFileTitleInput(event: WechatMiniprogram.Input) {
    const index = Number(event.currentTarget.dataset.index);
    this.setData({ [`replyFiles[${index}].title`]: event.detail.value });
  },
  onReplyFileNoteInput(event: WechatMiniprogram.Input) {
    const index = Number(event.currentTarget.dataset.index);
    this.setData({ [`replyFiles[${index}].note`]: event.detail.value });
  },
  onRemoveReplyFile(event: WechatMiniprogram.TouchEvent) {
    const index = Number(event.currentTarget.dataset.index);
    const replyFiles = [...this.data.replyFiles];
    replyFiles.splice(index, 1);
    this.setData({ replyFiles });
  },
  onReplyDeliveryChange(event: WechatMiniprogram.CustomEvent) {
    this.setData({
      replyOverride: (event.detail?.override ?? {}) as DeliveryOverride,
    });
  },
  async onSend() {
    if (this.data.sending) return;
    const text = this.data.replyText.trim();
    if (!text && this.data.replyFiles.length === 0) {
      wx.showToast({ title: "请输入回复内容或添加附件", icon: "none" });
      return;
    }
    // 客户刚回复完，紧接着就会有客服回复的提醒——在这个手势里把额度续上
    topUpSubscribeQuota();
    this.setData({ sending: true });
    const mutationKey = this.replyMutationKey;
    // 对齐 Web 端：纯附件回复的正文写「附件：文件名列表」，否则服务端 EMPTY_MESSAGE 拒绝
    // 纯附件回复用文件名无关的占位哨兵「附件」（对齐 Web ATTACHMENT_ONLY_MESSAGE_SENTINEL）：
    // 不把可变文件名写进不可变正文，引用预览改从实时附件列表重建
    const bodyHtml = text
      ? `<p>${escapeHtml(text).replace(/\n/g, "<br/>")}</p>`
      : `<p>附件</p>`;
    // 内部备注：消息与附件同为 INTERNAL，客户完全不可见
    const visibility: MessageVisibility = this.data.internalMode
      ? "INTERNAL"
      : "CUSTOMER_VISIBLE";
    try {
      const replyOverride = this.data.replyOverride;
      const result = await replyRequest(this.data.requestId, {
        body: bodyHtml,
        replyToMessageId: this.data.replyTarget?.id ?? null,
        clientMutationKey: mutationKey,
        visibility,
        // 内部备注本来不外发，不带覆盖
        ...(visibility === "CUSTOMER_VISIBLE" &&
        Object.keys(replyOverride).length > 0
          ? { deliveryOverride: replyOverride }
          : {}),
      });
      // 回复成功后换新 key，供下一次回复使用
      this.replyMutationKey = genMutationKey();
      let attachFailed = 0;
      for (const file of this.data.replyFiles) {
        try {
          await uploadAttachment({
            filePath: file.localPath,
            fileName: file.fileName,
            serviceRequestId: this.data.requestId,
            requestMessageId: result.message.id,
            title: file.title.trim(),
            note: file.note.trim(),
            visibility,
          });
        } catch {
          attachFailed += 1;
        }
      }
      if (attachFailed > 0) {
        wx.showToast({ title: `${attachFailed} 个附件上传失败`, icon: "none" });
      }
      this.setData({
        replyText: "",
        replyTarget: null,
        replyFiles: [],
        replyOverride: {},
      });
      await this.load();
    } catch (error) {
      // 风控拦截需要醒目、可读完整的提示（对齐 Web 表单错误展示）
      if (
        error instanceof ApiError &&
        error.code === "CONTACT_INFORMATION_BLOCKED"
      ) {
        wx.showModal({
          title: "无法发送",
          content:
            error.message ||
            "内容疑似包含联系方式或站外交易引导，已阻止发送。请继续通过平台沟通。",
          showCancel: false,
          confirmText: "我知道了",
        });
      } else {
        // 保留同一 mutationKey：用户点重试不会发出重复回复
        wx.showToast({
          title: error instanceof Error ? error.message : "发送失败，请重试",
          icon: "none",
        });
      }
    } finally {
      this.setData({ sending: false });
    }
  },

  // —— 附件预览 ——

  /**
   * 长按聊天附件 →「添加到项目文件」。收录只翻一个标记、不改归属，
   * 因此看不到本工单的人依然读不到它（服务端 RLS 兜底），客户与后台人员都可用。
   */
  onLongPressAttachment(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id ?? "");
    const name = String(event.currentTarget.dataset.name ?? "该文件");
    if (!id) return;
    wx.showActionSheet({
      itemList: ["添加到项目文件"],
      success: (res) => {
        if (res.tapIndex !== 0) return;
        setAttachmentProjectPin(id, true)
          .then(() => {
            wx.showToast({ title: "已添加到项目文件", icon: "success" });
          })
          .catch((error: unknown) => {
            wx.showToast({
              title:
                error instanceof Error ? error.message : `${name} 添加失败`,
              icon: "none",
            });
          });
      },
    });
  },
  async onOpenImage(event: WechatMiniprogram.TouchEvent) {
    const fileId = event.currentTarget.dataset.id as string;
    wx.showLoading({ title: "加载图片" });
    try {
      const localPath = await downloadAttachment(fileId);
      wx.hideLoading();
      await wx.previewImage({ urls: [localPath] });
    } catch (error) {
      wx.hideLoading();
      wx.showToast({
        title: error instanceof Error ? error.message : "图片加载失败",
        icon: "none",
      });
    }
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
