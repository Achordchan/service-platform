export type ProjectStatus =
  | "DRAFT"
  | "ACTIVE"
  | "PAUSED"
  | "COMPLETED"
  | "EXPIRED";

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

export type CustomerSpaceOption = {
  id: string;
  name: string;
  role?: "OWNER" | "MEMBER";
};

export type CustomerUser = {
  id: string;
  name: string;
  email: string;
  image?: string | null;
  soundNotificationsEnabled: boolean;
  themePreference: import("@/theme/theme-mode").ThemePreference;
};

export type ProjectSummary = {
  id: string;
  title: string;
  description?: string | null;
  status: ProjectStatus;
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
  serviceType: {
    id: string;
    name: string;
  };
  customerSpace: CustomerSpaceOption;
  managerNames: string[];
  requestCount: number;
  updateCount: number;
};

export type ProjectStaffMember = {
  id: string;
  name: string;
  role: "PROJECT_MANAGER" | "TECHNICIAN";
};

export type ProjectMilestone = {
  id: string;
  title: string;
  description?: string | null;
  status: MilestoneStatus;
  startDate?: string | null;
  endDate?: string | null;
  createdAt: string;
  contentRiskStatus?: "PENDING" | "REVOKED" | null;
};

export type ProjectUpdate = {
  id: string;
  title: string;
  body: string;
  authorName: string;
  createdAt: string;
  contentRiskStatus?: "PENDING" | "REVOKED" | null;
  comments: Array<{
    id: string;
    body: string;
    authorName: string;
    createdAt: string;
    contentRiskStatus?: "PENDING" | "REVOKED" | null;
  }>;
};

export type ProjectAttachment = {
  id: string;
  originalName: string;
  mimeType: string;
  size: number;
  createdAt: string;
  contentRiskStatus?: "PENDING" | "REVOKED" | null;
};

export type ProjectDetail = ProjectSummary & {
  contentRiskUiEnabled?: boolean;
  staff: ProjectStaffMember[];
  milestones: ProjectMilestone[];
  updates: ProjectUpdate[];
  attachments: ProjectAttachment[];
};

export type ServiceRequestSummary = {
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
  serviceTypeName: string;
  category: {
    id: string;
    name: string;
  };
  assigneeName?: string | null;
};

export type RequestAttachment = {
  id: string;
  originalName: string;
  mimeType: string;
  size: number;
  createdAt: string;
  contentRiskStatus?: "PENDING" | "REVOKED" | null;
};

export type RequestMessage = {
  id: string;
  body: string;
  isSystem?: boolean;
  isInitial?: boolean;
  supportPlaybook?: import("@/lib/support-reply-playbooks").SupportReplyPlaybook | null;
  authorId: string;
  authorName: string;
  authorImage?: string | null;
  authorPlatformRole?: string | null;
  authorSource?: "ACHORD" | "SUB2API" | "UNIVERSAL" | "SYSTEM";
  createdAt: string;
  replyToMessageId?: string | null;
  replyTo?: {
    id: string;
    body: string;
    authorId: string;
    authorName: string;
    authorSource?: "ACHORD" | "SUB2API" | "UNIVERSAL" | "SYSTEM";
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
};

export type ServiceRequestDetail = ServiceRequestSummary & {
  createdByName: string;
  assigneeNames?: string[];
  attachments: RequestAttachment[];
  messages: RequestMessage[];
  contentRiskUiEnabled: boolean;
};

export type RequestCategoryOption = {
  id: string;
  name: string;
};

export type RequestProjectOption = {
  id: string;
  title: string;
  serviceTypeName: string;
  categories: RequestCategoryOption[];
};
