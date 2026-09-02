export type StaffRole =
  | "PROJECT_MANAGER"
  | "TECHNICIAN"
  | "PLATFORM_ADMIN";

export type ProjectStatus =
  | "DRAFT"
  | "ACTIVE"
  | "PAUSED"
  | "COMPLETED"
  | "EXPIRED";

export type ProjectKind = "STANDARD" | "EXTERNAL_INTEGRATION";

export type MilestoneStatus =
  | "NOT_STARTED"
  | "IN_PROGRESS"
  | "COMPLETED";

export type RequestStatus =
  | "PENDING"
  | "IN_PROGRESS"
  | "WAITING_CUSTOMER"
  | "RESOLVED"
  | "CLOSED";

export type RequestPriority = "LOW" | "NORMAL" | "HIGH" | "URGENT";
export type ContentVisibility = "CUSTOMER_VISIBLE" | "INTERNAL";

export type StaffUser = {
  id: string;
  name: string;
  email: string;
  image?: string | null;
  role: StaffRole;
  soundNotificationsEnabled: boolean;
  themePreference: import("@/theme/theme-mode").ThemePreference;
};

export type ProjectListItem = {
  id: string;
  title: string;
  description?: string | null;
  status: ProjectStatus;
  kind: ProjectKind;
  currentStage?: string | null;
  showMilestones?: boolean;
  showProgress?: boolean;
  customerUpdatesEnabled?: boolean;
  customerRequestsEnabled?: boolean;
  customerFilesEnabled?: boolean;
  startDate?: string | null;
  endDate?: string | null;
  updatedAt: string;
  progress: number;
  customerSpace: { id: string; name: string };
  serviceType: { id: string; name: string };
  managerNames: string[];
  requestCount: number;
  externalConnectorKey?: string | null;
  externalConnectorLabel?: string | null;
};

export type ProjectOption = {
  id: string;
  name: string;
};

export type ProjectStaffMember = {
  id: string;
  userId: string;
  name: string;
  email: string;
  role: "PROJECT_MANAGER" | "TECHNICIAN";
};

export type StaffCandidate = {
  id: string;
  name: string;
  email: string;
  platformRole: "PLATFORM_ADMIN" | "PROJECT_MANAGER" | "TECHNICIAN";
};

export type ProjectMilestone = {
  id: string;
  title: string;
  description?: string | null;
  status: MilestoneStatus;
  startDate?: string | null;
  endDate?: string | null;
  comments?: Array<{
    id: string;
    body: string;
    authorId?: string | null;
    authorName: string;
    authorImage?: string | null;
    createdAt: string;
    contentRiskStatus?: "PENDING" | "REVOKED" | null;
  }>;
  createdAt: string;
  contentRiskStatus?: "PENDING" | "REVOKED" | null;
  attachments?: RequestAttachment[];
};

export type ProjectUpdate = {
  id: string;
  title: string;
  body: string;
  visibility: ContentVisibility;
  authorName: string;
  createdAt: string;
  updatedAt: string;
  hasEditHistory: boolean;
  contentRiskStatus?: "PENDING" | "REVOKED" | null;
  attachments?: RequestAttachment[];
  comments: Array<{
    id: string;
    body: string;
    visibility: ContentVisibility;
    authorId: string;
    authorName: string;
    authorImage?: string | null;
    createdAt: string;
    updatedAt: string;
    hasEditHistory: boolean;
    contentRiskStatus?: "PENDING" | "REVOKED" | null;
  }>;
};

export type ProjectDetail = ProjectListItem & {
  contentRiskUiEnabled?: boolean;
  staff: ProjectStaffMember[];
  milestones: ProjectMilestone[];
  updates: ProjectUpdate[];
  attachments: RequestAttachment[];
};

export type RequestListItem = {
  id: string;
  number: string;
  title: string;
  description: string;
  priority: RequestPriority;
  status: RequestStatus;
  archivedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  projectId: string;
  projectTitle: string;
  customerFilterKey?: string;
  customerName: string;
  serviceTypeName: string;
  categoryName: string;
  assigneeId?: string | null;
  assigneeName?: string | null;
  assignedStaff?: Array<{ id: string; name: string }>;
  createdByName: string;
  source?: "ACHORD" | "SUB2API" | "UNIVERSAL";
  sourceKey?: string | null;
  sourceLabel?: string | null;
  firstRespondedAt?: string | null;
  dueAt?: string | null;
};

export type RequestAttachment = {
  id: string;
  originalName: string;
  title?: string | null;
  note?: string | null;
  previewStatus?: "PENDING" | "READY" | "FAILED" | null;
  mimeType: string;
  size: number;
  visibility: ContentVisibility;
  createdAt: string;
  contentRiskStatus?: "PENDING" | "REVOKED" | null;
  /** 项目文件列表专用：来源与是否由「添加到项目文件」收录 */
  source?: "PROJECT" | "REQUEST" | "UPDATE" | "MILESTONE";
  pinned?: boolean;
};

export type RequestAssignee = {
  id: string;
  name: string;
  email?: string | null;
  image?: string | null;
  platformRole?: StaffRole | "CUSTOMER" | null;
};

export type RequestDetail = RequestListItem & {
  contentRiskUiEnabled: boolean;
  externalContact?: {
    externalUserId: string;
    email: string | null;
    username: string | null;
    status: "ACTIVE" | "BLOCKED";
    avatarUrl?: string | null;
    profileAttributes?: Record<string, unknown>;
    sourceKey: string;
    sourceLabel: string;
  } | null;
  assignees?: RequestAssignee[];
  attachments: RequestAttachment[];
  messages: Array<{
    id: string;
    body: string;
    bodyIsAttachmentPlaceholder?: boolean;
    visibility: ContentVisibility;
    isSystem?: boolean;
    isInitial?: boolean;
    supportPlaybook?: import("@/lib/support-reply-playbooks").SupportReplyPlaybook | null;
    authorId: string;
    authorName: string;
    authorImage?: string | null;
    authorPlatformRole?: StaffRole | "CUSTOMER" | null;
    authorSource?: "ACHORD" | "SUB2API" | "UNIVERSAL" | "SYSTEM";
    authorSourceKey?: string;
    authorSourceLabel?: string;
    createdAt: string;
    replyToMessageId?: string | null;
    replyTo?: {
      id: string;
      body: string;
      bodyIsAttachmentPlaceholder?: boolean;
      visibility: ContentVisibility;
      authorId: string;
      authorName: string;
      authorSource?: "ACHORD" | "SUB2API" | "UNIVERSAL" | "SYSTEM";
      authorSourceKey?: string;
      authorSourceLabel?: string;
      attachments: Array<{
        id: string;
        originalName: string;
      }>;
    } | null;
    attachments: RequestAttachment[];
    contentRiskStatus?: "PENDING" | "REVOKED" | null;
    contentRiskReason?: string | null;
    reeditBody?: string | null;
    reeditAttachmentCount?: number;
    reeditExpiresAt?: string | null;
  }>;
};

export type CustomerSpaceItem = {
  id: string;
  name: string;
  slug: string;
  memberLimit: number;
  status: "ACTIVE" | "SUSPENDED" | "ARCHIVED";
  ownerId: string;
  ownerName: string;
  ownerEmail: string;
  pendingEmailChange: {
    id: string;
    newEmail: string;
    expiresAt: string;
    lastSentAt: string;
    mailStatus: string | null;
    mailDispatchFailed: boolean;
  } | null;
  memberCount: number;
  projectCount: number;
  updatedAt: string;
};

export type ServiceTypeItem = {
  id: string;
  key: string;
  name: string;
  description?: string | null;
  active: boolean;
  updatedAt: string;
  slaResponseMinutes?: number | null;
  slaResolutionMinutes?: number | null;
  categories: Array<{
    id: string;
    name: string;
    description?: string | null;
    active: boolean;
  }>;
};
