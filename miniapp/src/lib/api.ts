import { API_BASE_URL } from "../config";
import { getToken } from "./auth";
import { ApiError, clearToken, request } from "./request";

// wx.uploadFile/downloadFile 不走 request.ts，401 处理需单独对齐：清登录态并回登录页
function handleAttachmentUnauthorized(status: number) {
  if (status === 401) {
    clearToken();
    wx.reLaunch({ url: "/pages/auth/login/page" });
    return true;
  }
  return false;
}

export { ApiError };

// 阶段 2 数据类型：对齐后端 /api/v1 响应（Service 层序列化形态）
export type RequestCategory = { id: string; name: string };

export type ProjectSummary = {
  attachments?: AttachmentMeta[];
  id: string;
  title: string;
  description: string | null;
  status: string;
  currentStage: string | null;
  showMilestones: boolean;
  showProgress: boolean;
  customerUpdatesEnabled: boolean;
  customerRequestsEnabled: boolean;
  customerFilesEnabled: boolean;
  startDate: string | null;
  endDate: string | null;
  createdAt: string;
  updatedAt: string;
  customerSpace: { id: string; name: string; status: string };
  serviceType: {
    id: string;
    key: string;
    name: string;
    requestCategories: RequestCategory[];
  };
  staff: Array<{ role: string; user: { id: string; name: string } }>;
  _count: { staff: number; updates: number; requests: number };
  progress: number;
  progressDetails: {
    total: number;
    completed: number;
    inProgress: number;
    notStarted: number;
  };
};

export type Milestone = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  startDate: string | null;
  endDate: string | null;
  sortOrder: number;
  contentRiskStatus?: string;
};

export type ProjectUpdate = {
  id: string;
  title: string;
  body: string;
  createdAt: string;
  author: { id: string; name: string };
  contentRiskStatus?: string;
  comments: Array<{
    id: string;
    body: string;
    createdAt: string;
    author: { id: string; name: string };
  }>;
};

export type AttachmentMeta = {
  id: string;
  originalName: string;
  title?: string | null;
  note?: string | null;
  mimeType: string;
  size: number;
  createdAt: string;
  contentRiskStatus?: string | null;
};

export type RequestMessage = {
  id: string;
  body: string;
  /** 服务端权威判定：正文是否为纯附件回复的生成占位（附件：<文件名列表>） */
  bodyIsAttachmentPlaceholder?: boolean;
  visibility: string;
  isSystem: boolean;
  isInitial: boolean;
  contentRiskStatus?: "PENDING" | "REVOKED" | null;
  contentRiskReason?: string | null;
  createdAt: string;
  authorId: string | null;
  author: { id: string; name: string; platformRole: string } | null;
  attachments: Array<
    AttachmentMeta & { inline: boolean; contentRiskStatus?: string }
  >;
  replyTo: {
    id: string;
    body: string;
    bodyIsAttachmentPlaceholder?: boolean;
    author: { id: string; name: string } | null;
    attachments?: Array<{
      id: string;
      originalName: string;
      title?: string | null;
      inline?: boolean;
    }>;
  } | null;
};

export type ServiceRequestSummary = {
  id: string;
  number: string;
  title: string;
  priority: string;
  status: string;
  projectId: string;
  createdAt: string;
  updatedAt: string;
  category: { id: string; name: string };
  assignee: { id: string; name: string } | null;
  createdBy: { id: string; name: string } | null;
};

export type ServiceRequestDetail = ServiceRequestSummary & {
  description: string;
  contentRiskUiEnabled?: boolean;
  project: { id: string; title: string; customerRequestsEnabled: boolean };
  messages: RequestMessage[];
  attachments: AttachmentMeta[];
};

export type RequestListResult = {
  requests: ServiceRequestSummary[];
  nextOffset: number | null;
  totalVisibleProjects: number;
};

export type CreateRequestResult = ServiceRequestSummary & {
  initialMessageId: string;
};

export type ReplyResult = {
  message: {
    id: string;
    body: string;
    createdAt: string;
  };
  requestStatus: string;
};

export function listProjects(): Promise<ProjectSummary[]> {
  return request<ProjectSummary[]>("/api/v1/projects", { timeoutMs: 20000 });
}

// 详情接口在列表字段基础上额外返回全量 updates / milestones / attachments
export type ProjectDetailResponse = ProjectSummary & {
  updates: unknown[];
  milestones: unknown[];
};

export function getProject(
  projectId: string,
): Promise<ProjectDetailResponse> {
  return request<ProjectDetailResponse>(
    `/api/v1/projects/${projectId}`,
    { timeoutMs: 20000 },
  );
}

export function listMilestones(
  projectId: string,
): Promise<{ milestones: Milestone[]; progress: { percentage: number } }> {
  return request(`/api/v1/projects/${projectId}/milestones`, { timeoutMs: 20000 });
}

export function listProjectUpdates(
  projectId: string,
): Promise<ProjectUpdate[]> {
  return request(`/api/v1/projects/${projectId}/updates`, { timeoutMs: 20000 });
}

export function listProjectRequests(
  projectId: string,
): Promise<ServiceRequestSummary[]> {
  return request<ServiceRequestSummary[]>(
    `/api/v1/projects/${projectId}/requests`,
    { timeoutMs: 20000 },
  );
}

export function listRequests(filters: {
  projectId?: string;
  status?: string;
  q?: string;
  limit?: number;
  offset?: number;
}): Promise<RequestListResult> {
  const params = new Array<string>();
  if (filters.projectId) params.push(`projectId=${filters.projectId}`);
  if (filters.status) params.push(`status=${filters.status}`);
  if (filters.q) params.push(`q=${encodeURIComponent(filters.q)}`);
  if (filters.limit !== undefined) params.push(`limit=${filters.limit}`);
  if (filters.offset !== undefined) params.push(`offset=${filters.offset}`);
  const query = params.length ? `?${params.join("&")}` : "";
  return request<RequestListResult>(`/api/v1/requests${query}`, { timeoutMs: 20000 });
}

export function getRequest(requestId: string): Promise<ServiceRequestDetail> {
  return request<ServiceRequestDetail>(`/api/v1/requests/${requestId}`, { timeoutMs: 20000 });
}

export function createRequest(
  projectId: string,
  input: {
    title: string;
    description: string;
    categoryId: string;
    priority: string;
    clientMutationKey: string;
  },
): Promise<CreateRequestResult> {
  return request<CreateRequestResult>(`/api/v1/projects/${projectId}/requests`, {
    method: "POST",
    data: input,
    idempotencyKey: input.clientMutationKey,
    timeoutMs: 30000,
  });
}

export function replyRequest(
  requestId: string,
  input: {
    body: string;
    replyToMessageId?: string | null;
    clientMutationKey: string;
  },
): Promise<ReplyResult> {
  return request<ReplyResult>(`/api/v1/requests/${requestId}/messages`, {
    method: "POST",
    data: {
      body: input.body,
      visibility: "CUSTOMER_VISIBLE",
      replyToMessageId: input.replyToMessageId ?? null,
    },
    idempotencyKey: input.clientMutationKey,
    timeoutMs: 30000,
  });
}


// —— 附件：wx.uploadFile / wx.downloadFile 专用封装 ——

export function uploadAttachment(input: {
  filePath: string;
  fileName: string;
  serviceRequestId: string;
  requestMessageId?: string;
  title?: string;
  note?: string;
}): Promise<AttachmentMeta> {
  return new Promise((resolve, reject) => {
    wx.uploadFile({
      url: `${API_BASE_URL}/api/v1/attachments`,
      filePath: input.filePath,
      name: "file",
      formData: {
        serviceRequestId: input.serviceRequestId,
        visibility: "CUSTOMER_VISIBLE",
        ...(input.requestMessageId
          ? { requestMessageId: input.requestMessageId }
          : {}),
        // wx.uploadFile 的 multipart 文件名取自临时路径（tmp_xxx.ext），
        // 显式提交真实文件名供服务端覆盖 originalName/下载名
        fileName: input.fileName,
        // 标题与文件名一致（未修改默认值）时不提交，展示端兜底 originalName
        ...(input.title && input.title !== input.fileName
          ? { title: input.title }
          : {}),
        ...(input.note ? { note: input.note } : {}),
      },
      header: { Authorization: `Bearer ${getToken()}` },
      success: (res) => {
        if (handleAttachmentUnauthorized(res.statusCode)) {
          reject(
            new ApiError(401, {
              code: "UNAUTHORIZED",
              message: "请重新登录",
            }),
          );
          return;
        }
        const body = safeJson<AttachmentMeta>(res.data);
        if (res.statusCode >= 200 && res.statusCode < 300 && body) {
          resolve(body);
          return;
        }
        reject(
          new ApiError(
            res.statusCode,
            (body as unknown as { error?: { code: string; message: string } })?.error ?? {
              code: "UPLOAD_FAILED",
              message: "附件上传失败，请重试",
            },
          ),
        );
      },
      fail: () =>
        reject(
          new ApiError(0, {
            code: "NETWORK_ERROR",
            message: "网络不可用，附件未上传",
          }),
        ),
    });
  });
}

export function downloadAttachment(
  attachmentId: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    wx.downloadFile({
      url: `${API_BASE_URL}/api/v1/attachments/${attachmentId}`,
      header: { Authorization: `Bearer ${getToken()}` },
      success: (res) => {
        if (handleAttachmentUnauthorized(res.statusCode)) {
          reject(
            new ApiError(401, {
              code: "UNAUTHORIZED",
              message: "请重新登录",
            }),
          );
          return;
        }
        if (res.statusCode === 200) {
          resolve(res.tempFilePath);
          return;
        }
        reject(
          new ApiError(res.statusCode, {
            code: "DOWNLOAD_FAILED",
            message: res.statusCode === 404 ? "文件不存在或无权访问" : "下载失败，请重试",
          }),
        );
      },
      fail: () =>
        reject(
          new ApiError(0, {
            code: "NETWORK_ERROR",
            message: "网络不可用，下载失败",
          }),
        ),
    });
  });
}

function safeJson<T>(raw: string): T | null {
  try {
    const parsed = JSON.parse(raw) as { data?: T };
    return parsed?.data ?? null;
  } catch {
    return null;
  }
}

// —— 通知（阶段 3）：路由已支持 Bearer ——

export type NotificationItem = {
  id: string;
  type: string;
  title: string;
  body: string;
  readAt: string | null;
  occurrenceCount: number;
  projectId: string | null;
  serviceRequestId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type NotificationListResult = {
  items: NotificationItem[];
  totalUnread: number;
  nextCursor: string | null;
};

export function listNotifications(filters: {
  limit?: number;
  cursor?: string;
}): Promise<NotificationListResult> {
  const params = new Array<string>();
  if (filters.limit !== undefined) params.push(`limit=${filters.limit}`);
  if (filters.cursor) params.push(`cursor=${encodeURIComponent(filters.cursor)}`);
  const query = params.length ? `?${params.join("&")}` : "";
  return request<NotificationListResult>(`/api/v1/notifications${query}`);
}

export function markNotificationRead(id: string): Promise<void> {
  return request(`/api/v1/notifications`, {
    method: "PATCH",
    data: { id },
  }).then(() => undefined);
}

/** 进入/停留在工单详情时，把该工单相关通知标记已读（对齐 Web useRequestNotificationsRead） */
export function markRequestNotificationsRead(
  serviceRequestId: string,
): Promise<void> {
  return request(`/api/v1/notifications`, {
    method: "PATCH",
    data: { serviceRequestId },
  }).then(() => undefined);
}

export type ProjectNotificationScope =
  | "overview"
  | "updates"
  | "milestones"
  | "files";

/** 项目详情切 tab 时清对应 scope 的未读（对齐 Web project-tabs） */
export function markProjectScopeNotificationsRead(
  projectId: string,
  projectScope: ProjectNotificationScope,
): Promise<void> {
  return request(`/api/v1/notifications`, {
    method: "PATCH",
    data: { projectId, projectScope },
  }).then(() => undefined);
}

export function markAllNotificationsRead(): Promise<void> {
  return request(`/api/v1/notifications`, {
    method: "PATCH",
    data: { all: true },
  }).then(() => undefined);
}

/** 小程序确认网页版扫码登录（web-login 确认页调用，payload 形如 t:<token>） */
export function confirmWebQrLogin(
  qrPayload: string,
): Promise<{ confirmed: true }> {
  return request(`/api/miniapp/auth/qr-login`, {
    method: "POST",
    data: { qrPayload },
  });
}

export type WechatTemplateKey =
  | "REQUEST_REPLY"
  | "REQUEST_STATUS"
  | "PROJECT_UPDATE";

export function reportSubscribeGrant(
  templateKey: WechatTemplateKey,
): Promise<{ remaining: number }> {
  return request(`/api/miniapp/subscribe-message/grants`, {
    method: "POST",
    data: { templateKey, accept: true },
  });
}

export type SubscribeGrantState = {
  templateKey: WechatTemplateKey;
  remaining: number;
};

/**
 * 读取当前用户各订阅模板的剩余额度（服务端 WechatSubscribeGrant.remaining）。
 * 与后端发送门槛同源，用于展示真实订阅状态与顶部引导横幅的检测。
 */
export function getSubscribeGrants(): Promise<{
  grants: SubscribeGrantState[];
}> {
  return request(`/api/miniapp/subscribe-message/grants`);
}

// —— 通知偏好 ——

export type NotificationPreferences = {
  soundNotificationsEnabled: boolean;
  requestEmailNotificationsEnabled: boolean;
  perType: Array<{ ruleKey: string; emailEnabled: boolean }>;
};

export function getNotificationPreferences(): Promise<NotificationPreferences> {
  return request(`/api/v1/me/notification-preferences`);
}

export function updateNotificationPreferences(input: {
  soundNotificationsEnabled?: boolean;
  requestEmailNotificationsEnabled?: boolean;
}): Promise<NotificationPreferences> {
  return request(`/api/v1/me/notification-preferences`, {
    method: "PATCH",
    data: input,
  });
}

// —— 成员管理（客户 Owner 复用 admin 路由，Bearer 可用）——

export type SpaceMember = {
  id: string;
  role: "OWNER" | "MEMBER";
  user: {
    id: string;
    name: string;
    email: string;
    wechatBinding: { createdAt: string } | null;
  };
};

export type SpaceInvitation = {
  id: string;
  email: string;
  expiresAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
};

export type CustomerSpaceDetail = {
  id: string;
  name: string;
  memberLimit: number;
  ownerId: string;
  usage: number;
  memberships: SpaceMember[];
  invitations: SpaceInvitation[];
};

// 成员管理走小程序专用路由：读取侧显式 Owner 校验
// （/api/v1/admin 版本的 getCustomerSpace 仅靠 RLS，会向普通成员泄露全量邮箱）
export function getCustomerSpaceDetail(
  customerSpaceId: string,
): Promise<CustomerSpaceDetail> {
  return request<CustomerSpaceDetail>(
    `/api/miniapp/space/members?spaceId=${customerSpaceId}`,
  );
}

export function inviteSpaceMember(
  customerSpaceId: string,
  email: string,
): Promise<void> {
  return request(
    `/api/miniapp/space/invitations?spaceId=${customerSpaceId}`,
    { method: "POST", data: { email } },
  ).then(() => undefined);
}

export function removeSpaceMember(
  customerSpaceId: string,
  membershipId: string,
): Promise<void> {
  return request(
    `/api/miniapp/space/members/${membershipId}?spaceId=${customerSpaceId}`,
    { method: "DELETE" },
  ).then(() => undefined);
}

export type SubscribeTemplateConfig = {
  templateKey: WechatTemplateKey;
  templateId: string;
};

export function getSubscribeMessageConfig(): Promise<{
  templates: SubscribeTemplateConfig[];
}> {
  return request(`/api/miniapp/subscribe-message/config`);
}

// —— 通知未读摘要（TabBar 角标统一刷新）——

export type NotificationSummaryResult = { totalUnread: number };

export function getNotificationSummary(): Promise<NotificationSummaryResult> {
  return request<NotificationSummaryResult>(`/api/v1/notifications/summary`);
}

// —— 个人设置（对齐 Web 端 account 页能力子集）——

export function updateProfileName(name: string): Promise<{ name: string }> {
  return request(`/api/v1/profile`, { method: "PATCH", data: { name } });
}

export function uploadProfileAvatar(input: {
  filePath: string;
  name: string;
}): Promise<{ name: string }> {
  return new Promise((resolve, reject) => {
    wx.uploadFile({
      url: `${API_BASE_URL}/api/v1/profile`,
      filePath: input.filePath,
      name: "avatar",
      formData: { name: input.name },
      header: {
        Authorization: `Bearer ${getToken()}`,
      },
      success: (res) => {
        if (res.statusCode === 401) {
          clearToken();
          wx.reLaunch({ url: "/pages/auth/login/page" });
        }
        const body = safeJson<{ name: string }>(res.data);
        if (res.statusCode >= 200 && res.statusCode < 300 && body) {
          resolve(body);
          return;
        }
        reject(
          new ApiError(res.statusCode, {
            code: "UPLOAD_FAILED",
            message: "头像上传失败",
          }),
        );
      },
      fail: () =>
        reject(
          new ApiError(0, {
            code: "NETWORK_ERROR",
            message: "网络不可用",
          }),
        ),
    });
  });
}

export type PendingEmailChange = {
  id: string;
  newEmail: string;
  expiresAt: string;
  lastSentAt: string | null;
} | null;

export function getEmailChange(): Promise<PendingEmailChange> {
  return request(`/api/v1/me/email-change`);
}

export function requestEmailChange(
  newEmail: string,
): Promise<{ newEmail: string }> {
  return request(`/api/v1/me/email-change`, {
    method: "POST",
    data: { newEmail },
  });
}

export function cancelEmailChange(): Promise<void> {
  return request(`/api/v1/me/email-change`, { method: "DELETE" }).then(
    () => undefined,
  );
}
