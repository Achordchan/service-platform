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

export type EntityAttachment = {
  id: string;
  originalName: string;
  title?: string | null;
  note?: string | null;
  mimeType: string;
  size: number;
  visibility?: string;
  createdAt: string;
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
  attachments?: EntityAttachment[];
};

export type ProjectUpdate = {
  id: string;
  title: string;
  body: string;
  createdAt: string;
  author: { id: string; name: string };
  contentRiskStatus?: string;
  attachments?: EntityAttachment[];
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
  /** 项目文件列表专用：来源与是否被显式收录 */
  source?: "PROJECT" | "REQUEST" | "UPDATE" | "MILESTONE";
  pinned?: boolean;
};

/** 处理指南快照：随消息一起下发，正文只含标题+摘要，全文在这里 */
export type SupportPlaybookSnapshot = {
  key: string;
  category: "REMOTE" | "DIAGNOSTIC" | "INFORMATION";
  title: string;
  summary: string;
  introduction: string;
  content?: string;
  steps: string[];
  safetyNotes: string[];
};

export type RequestMessage = {
  id: string;
  body: string;
  supportPlaybook?: SupportPlaybookSnapshot | null;
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
  /** 多人处理列表（后台指派用；跨项目列表与详情均返回） */
  assignees?: Array<{ userId: string; user: { id: string; name: string } }>;
  createdBy: { id: string; name: string } | null;
  /** 跨项目列表（/api/v1/requests）附带项目归属，员工端展示用 */
  project?: { id: string; title: string };
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

// —— 项目交付写操作（员工/管理员）：后端按 actor 权限裁决，客户端仅按能力显示入口 ——

/** 发布进度动态。body 为 HTML（服务端 sanitize）；visibility 缺省客户可见 */
export function createProjectUpdate(
  projectId: string,
  input: {
    title: string;
    body: string;
    visibility?: MessageVisibility;
    deliveryOverride?: DeliveryOverride;
  },
): Promise<{ id: string }> {
  return request(`/api/v1/projects/${projectId}/updates`, {
    method: "POST",
    data: input,
    timeoutMs: 30000,
  });
}

export function editProjectUpdate(
  projectId: string,
  updateId: string,
  input: { title?: string; body?: string },
): Promise<{ id: string }> {
  return request(`/api/v1/projects/${projectId}/updates/${updateId}`, {
    method: "PATCH",
    data: input,
    timeoutMs: 30000,
  });
}

export function deleteProjectUpdate(
  projectId: string,
  updateId: string,
): Promise<void> {
  return request(`/api/v1/projects/${projectId}/updates/${updateId}`, {
    method: "DELETE",
  }).then(() => undefined);
}

export function createUpdateComment(
  projectId: string,
  updateId: string,
  body: string,
): Promise<{ id: string }> {
  return request(
    `/api/v1/projects/${projectId}/updates/${updateId}/comments`,
    { method: "POST", data: { body }, timeoutMs: 20000 },
  );
}

export function editUpdateComment(
  projectId: string,
  updateId: string,
  commentId: string,
  body: string,
): Promise<{ id: string }> {
  return request(
    `/api/v1/projects/${projectId}/updates/${updateId}/comments/${commentId}`,
    { method: "PATCH", data: { body }, timeoutMs: 20000 },
  );
}

export function deleteUpdateComment(
  projectId: string,
  updateId: string,
  commentId: string,
): Promise<void> {
  return request(
    `/api/v1/projects/${projectId}/updates/${updateId}/comments/${commentId}`,
    { method: "DELETE" },
  ).then(() => undefined);
}

export type MilestoneStatus = "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED";

export type MilestoneInput = {
  title: string;
  description?: string | null;
  status?: MilestoneStatus;
  /** ISO datetime 或 null；页面把「YYYY-MM-DD」转成 ISO 再传 */
  startDate?: string | null;
  endDate?: string | null;
};

export function createMilestone(
  projectId: string,
  input: MilestoneInput & { deliveryOverride?: DeliveryOverride },
): Promise<Milestone> {
  return request(`/api/v1/projects/${projectId}/milestones`, {
    method: "POST",
    data: input,
    timeoutMs: 20000,
  });
}

export function editMilestone(
  projectId: string,
  milestoneId: string,
  input: Partial<MilestoneInput> & { deliveryOverride?: DeliveryOverride },
): Promise<Milestone> {
  return request(`/api/v1/projects/${projectId}/milestones/${milestoneId}`, {
    method: "PATCH",
    data: input,
    timeoutMs: 20000,
  });
}

export function deleteMilestone(
  projectId: string,
  milestoneId: string,
): Promise<void> {
  return request(`/api/v1/projects/${projectId}/milestones/${milestoneId}`, {
    method: "DELETE",
  }).then(() => undefined);
}

/** 更新当前阶段（项目交付权限）。currentStage 传 null/空清空 */
export function updateProjectStage(
  projectId: string,
  currentStage: string | null,
): Promise<{ id: string; currentStage: string | null }> {
  return request(`/api/v1/projects/${projectId}/stage`, {
    method: "PATCH",
    data: { currentStage },
    timeoutMs: 20000,
  });
}

export type ProjectSettingsInput = {
  title?: string;
  description?: string | null;
  status?: string;
  showMilestones?: boolean;
  showProgress?: boolean;
  customerUpdatesEnabled?: boolean;
  customerRequestsEnabled?: boolean;
  customerFilesEnabled?: boolean;
  startDate?: string | null;
  endDate?: string | null;
};

/** 更新项目设置（仅平台管理员，服务端 updateProject 断言 isPlatformAdmin） */
export function updateProjectSettings(
  projectId: string,
  input: ProjectSettingsInput,
): Promise<ProjectSummary> {
  return request(`/api/v1/projects/${projectId}`, {
    method: "PATCH",
    data: input,
    timeoutMs: 20000,
  });
}

export function listRequests(filters: {
  projectId?: string;
  status?: string;
  q?: string;
  priority?: string;
  /** 归档范围：默认 EXCLUDE（不含归档） */
  archived?: "EXCLUDE" | "ONLY" | "ALL";
  assignedToMe?: boolean;
  limit?: number;
  offset?: number;
}): Promise<RequestListResult> {
  const params = new Array<string>();
  if (filters.projectId) params.push(`projectId=${filters.projectId}`);
  if (filters.status) params.push(`status=${filters.status}`);
  if (filters.q) params.push(`q=${encodeURIComponent(filters.q)}`);
  if (filters.priority) params.push(`priority=${filters.priority}`);
  if (filters.archived) params.push(`archived=${filters.archived}`);
  if (filters.assignedToMe) params.push(`assignedToMe=true`);
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

export type MessageVisibility = "CUSTOMER_VISIBLE" | "INTERNAL";

export function replyRequest(
  requestId: string,
  input: {
    body: string;
    replyToMessageId?: string | null;
    clientMutationKey: string;
    /** 员工可发内部备注（INTERNAL）；缺省为客户可见回复 */
    visibility?: MessageVisibility;
    deliveryOverride?: DeliveryOverride;
  },
): Promise<ReplyResult> {
  return request<ReplyResult>(`/api/v1/requests/${requestId}/messages`, {
    method: "POST",
    data: {
      body: input.body,
      visibility: input.visibility ?? "CUSTOMER_VISIBLE",
      replyToMessageId: input.replyToMessageId ?? null,
      ...(input.deliveryOverride
        ? { deliveryOverride: input.deliveryOverride }
        : {}),
    },
    idempotencyKey: input.clientMutationKey,
    timeoutMs: 30000,
  });
}

// —— 员工操作：状态、指派、项目人员（后端按 actor 权限裁决，此处仅透传）——

export function changeRequestStatus(
  requestId: string,
  status: string,
  deliveryOverride?: DeliveryOverride,
): Promise<{ status: string }> {
  return request(`/api/v1/requests/${requestId}/status`, {
    method: "PATCH",
    data: deliveryOverride ? { status, deliveryOverride } : { status },
    timeoutMs: 20000,
  });
}

export function assignRequest(
  requestId: string,
  assigneeIds: string[],
): Promise<{ assigneeId: string | null }> {
  return request(`/api/v1/requests/${requestId}/assignee`, {
    method: "PATCH",
    data: { assigneeIds },
    timeoutMs: 20000,
  });
}

export type ProjectStaffMember = {
  id: string;
  role: "PROJECT_MANAGER" | "TECHNICIAN";
  userId: string;
  /** 员工视角服务端会带 platformRole（客户视角不带）：项目角色能不能切要看它 */
  user: { id: string; name: string; platformRole?: string };
};

export function listProjectStaff(
  projectId: string,
): Promise<ProjectStaffMember[]> {
  return request<ProjectStaffMember[]>(
    `/api/v1/projects/${projectId}/staff`,
    { timeoutMs: 20000 },
  );
}

export type ProjectStaffRole = "PROJECT_MANAGER" | "TECHNICIAN";

export type StaffCandidate = {
  id: string;
  name: string;
  email: string;
  platformRole: "PLATFORM_ADMIN" | "PROJECT_MANAGER" | "TECHNICIAN";
};

/** 可加入该项目的内部人员候选（管理员/项目经理/技术，服务端按 manage_staff 权限裁决） */
export function listAssignableProjectStaff(
  projectId: string,
): Promise<StaffCandidate[]> {
  return request<StaffCandidate[]>(
    `/api/v1/projects/${projectId}/staff/assignable`,
    { timeoutMs: 20000 },
  );
}

export function addProjectStaff(
  projectId: string,
  input: {
    userId: string;
    role: ProjectStaffRole;
    deliveryOverride?: DeliveryOverride;
  },
): Promise<ProjectStaffMember> {
  return request(`/api/v1/projects/${projectId}/staff`, {
    method: "POST",
    data: input,
    timeoutMs: 20000,
  });
}

export function updateProjectStaffRole(
  projectId: string,
  projectStaffId: string,
  role: ProjectStaffRole,
  deliveryOverride?: DeliveryOverride,
): Promise<ProjectStaffMember> {
  return request(`/api/v1/projects/${projectId}/staff/${projectStaffId}`, {
    method: "PATCH",
    data: { role, ...(deliveryOverride ? { deliveryOverride } : {}) },
    timeoutMs: 20000,
  });
}

export function removeProjectStaff(
  projectId: string,
  projectStaffId: string,
  deliveryOverride?: DeliveryOverride,
): Promise<void> {
  return request(`/api/v1/projects/${projectId}/staff/${projectStaffId}`, {
    method: "DELETE",
    // 移出也会给当事人发通知，同样带上本次操作的提醒方式覆盖
    data: deliveryOverride ? { deliveryOverride } : undefined,
  }).then(() => undefined);
}


// —— 附件：wx.uploadFile / wx.downloadFile 专用封装 ——

export function uploadAttachment(input: {
  filePath: string;
  fileName: string;
  /** 工单附件（与项目文件二选一） */
  serviceRequestId?: string;
  /** 项目文件（与工单附件二选一） */
  projectId?: string;
  /** 挂到进度动态 / 里程碑上（需同时给 projectId） */
  projectUpdateId?: string;
  milestoneId?: string;
  requestMessageId?: string;
  title?: string;
  note?: string;
  /** 内部备注的附件应随消息同为 INTERNAL，客户不可见 */
  visibility?: MessageVisibility;
}): Promise<AttachmentMeta> {
  return new Promise((resolve, reject) => {
    wx.uploadFile({
      url: `${API_BASE_URL}/api/v1/attachments`,
      filePath: input.filePath,
      name: "file",
      formData: {
        ...(input.serviceRequestId
          ? { serviceRequestId: input.serviceRequestId }
          : {}),
        ...(input.projectId ? { projectId: input.projectId } : {}),
        ...(input.projectUpdateId
          ? { projectUpdateId: input.projectUpdateId }
          : {}),
        ...(input.milestoneId ? { milestoneId: input.milestoneId } : {}),
        visibility: input.visibility ?? "CUSTOMER_VISIBLE",
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

// —— 员工工作台（简版概览）——

export type DashboardAnalytics = {
  volumeTrend: Array<{ date: string; count: number }>;
  statusDistribution: Array<{ status: string; count: number }>;
  responseTimeByPriority: Array<{
    priority: string;
    avgMinutes: number;
    count: number;
  }>;
};

/** 员工工作台统计（后端 assertAllowed(isStaff)，员工均可） */
export function getDashboardAnalytics(): Promise<DashboardAnalytics> {
  return request<DashboardAnalytics>(`/api/v1/admin/dashboard/analytics`, {
    timeoutMs: 20000,
  });
}

// —— 简版审计日志（仅平台管理员）——

export type AuditRow = {
  id: string;
  action: string;
  actionLabel: string;
  resourceType: string;
  resourceLabel: string;
  resourceId: string | null;
  result: string;
  resultLabel: string;
  createdAt: string;
  ipAddress: string | null;
  userAgent: string | null;
  metadata: unknown;
  projectId: string | null;
  customerSpaceId: string | null;
  serviceRequestId: string | null;
  actorDisplay: { name: string; secondary: string };
};

/** 筛选项由服务端连中文标签一起下发，小程序不复制那套动作码字典 */
export type AuditFacetOption = { value: string; label: string };

/** 只声明带标签的三个字段：同层的 actions/resourceTypes/results 是 Web 在用的
 *  原始字符串数组，小程序不消费 */
export type AuditFacets = {
  actionOptions: AuditFacetOption[];
  resourceTypeOptions: AuditFacetOption[];
  resultOptions: AuditFacetOption[];
};

export type AuditPage = {
  total: number;
  page: number;
  pageSize: number;
  rows: AuditRow[];
  facets?: AuditFacets;
};

export type AuditFilters = {
  search?: string;
  action?: string;
  resourceType?: string;
  result?: string;
  /** YYYY-MM-DD，服务端按 +08:00 换算日界 */
  from?: string;
  to?: string;
};

export function listAuditLogs(
  params: AuditFilters & {
    page?: number;
    pageSize?: number;
    withFacets?: boolean;
  },
): Promise<AuditPage> {
  const query = new Array<string>();
  if (params.search) query.push(`search=${encodeURIComponent(params.search)}`);
  if (params.action) query.push(`action=${encodeURIComponent(params.action)}`);
  if (params.resourceType) {
    query.push(`resourceType=${encodeURIComponent(params.resourceType)}`);
  }
  if (params.result) query.push(`result=${encodeURIComponent(params.result)}`);
  if (params.from) query.push(`from=${params.from}`);
  if (params.to) query.push(`to=${params.to}`);
  if (params.page !== undefined) query.push(`page=${params.page}`);
  if (params.pageSize !== undefined) query.push(`pageSize=${params.pageSize}`);
  if (params.withFacets) query.push("withFacets=1");
  const suffix = query.length ? `?${query.join("&")}` : "";
  return request<AuditPage>(`/api/v1/admin/audit-logs${suffix}`, {
    timeoutMs: 20000,
  });
}

// —— 发送前提醒预览与本次覆盖 ——

export type DeliveryChannelRule = {
  key: string;
  label: string;
  notificationEnabled: boolean;
  emailEnabled: boolean;
  wechatEnabled: boolean;
  emailSupported: boolean;
  wechatSupported: boolean;
};

export type DeliveryScene =
  | {
      scene: "PROJECT_UPDATE";
      projectId: string;
      visibility: "CUSTOMER_VISIBLE" | "INTERNAL";
    }
  | { scene: "PROJECT_MILESTONE"; projectId: string }
  | { scene: "PROJECT_STAFF"; projectId: string; targetUserId: string }
  | { scene: "REQUEST_PUBLIC_MESSAGE"; requestId: string }
  | { scene: "REQUEST_STATUS"; requestId: string; status: string };

export type DeliveryPreviewRecipient = {
  userId: string;
  name: string;
  isCustomer: boolean;
  /** 外部门户联系人：无站内、无微信，只有邮件 */
  external: boolean;
  emailState: "READY" | "USER_OFF" | "NOT_TARGETED";
  wechatState: "READY" | "NO_BINDING" | "NO_QUOTA" | "UNSUPPORTED";
};

export type DeliveryPreview = {
  ruleKey: string;
  label: string;
  rule: {
    notificationEnabled: boolean;
    emailEnabled: boolean;
    wechatEnabled: boolean;
    emailSupported: boolean;
    wechatSupported: boolean;
  };
  mailLocalOutbox: boolean;
  recipients: DeliveryPreviewRecipient[];
  summary: {
    total: number;
    emailReady: number;
    emailUserOff: number;
    wechatReady: number;
    wechatUnavailable: number;
  };
};

export type DeliveryOverride = {
  notification?: boolean;
  email?: boolean;
  wechat?: boolean;
  excludeUserIds?: string[];
};

export function listDeliveryChannels(): Promise<DeliveryChannelRule[]> {
  return request(`/api/v1/notifications/delivery-channels`);
}

export function previewDelivery(scene: DeliveryScene): Promise<DeliveryPreview> {
  return request(`/api/v1/notifications/delivery-preview`, {
    method: "POST",
    data: scene,
  });
}

// —— 员工工单处理：归档 / 撤回消息 / 处理指南 ——

export function changeRequestArchive(
  requestId: string,
  archived: boolean,
): Promise<{ archivedAt: string | null }> {
  return request(`/api/v1/requests/${requestId}/archive`, {
    method: "PATCH",
    data: { archived },
    timeoutMs: 20000,
  });
}

/** 仅平台管理员：由系统撤回一条消息并留下理由 */
export function revokeRequestMessage(
  requestId: string,
  messageId: string,
  reason: string,
): Promise<unknown> {
  return request(`/api/v1/requests/${requestId}/messages/${messageId}/revoke`, {
    method: "POST",
    data: { reason },
    timeoutMs: 20000,
  });
}

export type SupportPlaybook = SupportPlaybookSnapshot;

export function listSupportPlaybooks(): Promise<SupportPlaybook[]> {
  return request(`/api/v1/support-playbooks`, { timeoutMs: 20000 });
}

/** 发送处理指南：正文由服务端按模板渲染，这里只提交 key */
export function sendSupportPlaybook(
  requestId: string,
  playbookKey: string,
  deliveryOverride?: DeliveryOverride,
): Promise<ReplyResult> {
  return request<ReplyResult>(`/api/v1/requests/${requestId}/messages`, {
    method: "POST",
    data: {
      body: "",
      visibility: "CUSTOMER_VISIBLE",
      supportPlaybookKey: playbookKey,
      ...(deliveryOverride ? { deliveryOverride } : {}),
    },
    timeoutMs: 30000,
  });
}

/** 把工单聊天/动态里的附件收录进项目文件（或移出）。收录不改可见性。 */
export function setAttachmentProjectPin(
  attachmentId: string,
  pinned: boolean,
): Promise<{ id: string; pinned: boolean }> {
  return request(`/api/v1/attachments/${attachmentId}/pin`, {
    method: "POST",
    data: { pinned },
    timeoutMs: 20000,
  });
}

// —— 在线状态上报（与 Web 同一个端点；client 固定为 MINIAPP）——

export type PresenceResult = {
  counterpartOnline: boolean;
  counterpartClients: string[];
};

export function reportRequestPresence(
  requestId: string,
  action: "heartbeat" | "leave",
  sessionId: string,
): Promise<PresenceResult> {
  return request(`/api/v1/requests/${requestId}/presence`, {
    method: "POST",
    data: {
      sessionId,
      action,
      client: "MINIAPP",
      // 小程序没有 Intl.DateTimeFormat 的完整实现，取系统时区兜底
      timezone: presenceTimezone(),
    },
    timeoutMs: 15000,
  });
}

function presenceTimezone(): string | undefined {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return zone || undefined;
  } catch {
    return undefined;
  }
}
