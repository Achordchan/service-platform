import { ensureLoggedIn, fetchMeCached, cancelPendingActivate } from "../../lib/auth";
import {
  getRequest,
  replyRequest,
  uploadAttachment,
  downloadAttachment,
  markRequestNotificationsRead,
  type ServiceRequestDetail,
  type RequestMessage,
} from "../../lib/api";
import { ensureBadgeSync } from "../../lib/badge";
import { eventSync } from "../../lib/events";
import { pickAttachments, previewLocalFile } from "../../lib/pick-files";
import {
  formatFileSize,
  REQUEST_STATUS_LABELS,
  REQUEST_STATUS_TONES,
  REQUEST_PRIORITY_LABELS,
  escapeHtml,
  formatDateTime,
  htmlToText,
  genMutationKey,
  type RequestStatusValue,
  type RequestPriorityValue,
} from "../../lib/format";
import { ApiError } from "../../lib/request";
import {
  ensureSubscribeStateCached,
  topUpSubscribeQuota,
} from "../../lib/subscribe";

type ViewMessage = RequestMessage & {
  authorName: string;
  timeText: string;
  isMine: boolean;
  isAdmin: boolean;
  bodyText: string;
  revoked: boolean;
  revokedText: string;
  reviewing: boolean;
  replyPreview: string;
  images: Array<{ id: string; name: string; note: string }>;
  files: Array<{ id: string; name: string; size: string; note: string }>;
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

Page({
  data: {
    requestId: "",
    loading: true,
    loadError: "",
    request: null as ServiceRequestDetail | null,
    statusLabel: "",
    statusTone: "neutral",
    priorityLabel: "",
    loadErrorTitle: "加载失败",
    canRetry: true,
    messages: [] as ViewMessage[],
    // 回复状态
    replyText: "",
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
  // 校验中挂起的 activate；未真正启动 SSE 前不得 stop()（配平计数）
  pendingActivate: null as (() => void) | null,
  sseStarted: false,

  onLoad(query: Record<string, string | undefined>) {
    this.setData({ requestId: query.id ?? "" });
    this.replyMutationKey = genMutationKey();
    this.boundEventHandler = (events) => this.onRealtimeEvents(events);
    void fetchMeCached()
      .then((me) => {
        this.myUserId = me.user.id;
        if (this.data.messages.length > 0) {
          void this.load();
        }
      })
      .catch(() => undefined);
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
    void this.load();
    // 活跃页面保持实时流：员工回复即时刷新（SSE，PRD §19）
    if (this.boundEventHandler) {
      eventSync.on(this.boundEventHandler);
    }
    eventSync.start();
    this.sseStarted = true;
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
          })),
      };
      this.setData({
        loading: false,
        loadError: "",
        request: decoratedRequest,
        statusLabel:
          REQUEST_STATUS_LABELS[request.status as RequestStatusValue] ??
          request.status,
        statusTone:
          REQUEST_STATUS_TONES[request.status as RequestStatusValue] ??
          "neutral",
        priorityLabel:
          REQUEST_PRIORITY_LABELS[request.priority as RequestPriorityValue] ??
          request.priority,
        messages,
        scrollTop: messages.length * 1000,
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
  decorateMessage(message: RequestMessage): ViewMessage {
    // 对齐 Web request-chat-thread：被内容风控撤回的附件（含标题/备注）不渲染
    const attachments: AttachmentMetaLite[] = (
      message.attachments ?? []
    ).filter((att) => att.contentRiskStatus !== "REVOKED");
    return {
      ...message,
      authorName: message.author?.name ?? "系统",
      timeText: formatDateTime(message.createdAt),
      isMine: message.authorId !== null && message.authorId === this.myUserId,
      // 对齐 Web：仅平台管理员消息加「管理员」标识
      isAdmin: message.author?.platformRole === "PLATFORM_ADMIN",
      bodyText: htmlToText(message.body),
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
        ? `${message.replyTo.author?.name ?? ""}: ${htmlToText(message.replyTo.body).slice(0, 60)}`
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
    wx.showActionSheet({
      itemList: ["回复此消息", "复制文本"],
      success: (res) => {
        if (res.tapIndex === 0) {
          this.setData({ replyTarget: message });
        } else if (res.tapIndex === 1) {
          this.copyMessageText(message);
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
    // 正文用原始文件名而非自定义标题：标题可能随附件被风控撤回，不能残留正文
    const bodyHtml = text
      ? `<p>${escapeHtml(text).replace(/\n/g, "<br/>")}</p>`
      : `<p>附件：${this.data.replyFiles
          .map((file) => escapeHtml(file.fileName))
          .join("、") || "文件"}</p>`;
    try {
      const result = await replyRequest(this.data.requestId, {
        body: bodyHtml,
        replyToMessageId: this.data.replyTarget?.id ?? null,
        clientMutationKey: mutationKey,
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
          });
        } catch {
          attachFailed += 1;
        }
      }
      if (attachFailed > 0) {
        wx.showToast({ title: `${attachFailed} 个附件上传失败`, icon: "none" });
      }
      this.setData({ replyText: "", replyTarget: null, replyFiles: [] });
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
