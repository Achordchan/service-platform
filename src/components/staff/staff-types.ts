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
};

export type ProjectListItem = {
  id: string;
  title: string;
  description?: string | null;
  status: ProjectStatus;
  currentStage?: string | null;
  showMilestones?: boolean;
  showProgress?: boolean;
  startDate?: string | null;
  endDate?: string | null;
  updatedAt: string;
  progress: number;
  customerSpace: { id: string; name: string };
  serviceType: { id: string; name: string };
  managerNames: string[];
  requestCount: number;
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
};

export type ProjectUpdate = {
  id: string;
  title: string;
  body: string;
  visibility: ContentVisibility;
  authorName: string;
  createdAt: string;
  comments: Array<{
    id: string;
    body: string;
    visibility: ContentVisibility;
    authorName: string;
    createdAt: string;
  }>;
};

export type ProjectDetail = ProjectListItem & {
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
  createdAt: string;
  updatedAt: string;
  projectId: string;
  projectTitle: string;
  customerName: string;
  serviceTypeName: string;
  categoryName: string;
  assigneeId?: string | null;
  assigneeName?: string | null;
  createdByName: string;
};

export type RequestAttachment = {
  id: string;
  originalName: string;
  mimeType: string;
  size: number;
  visibility: ContentVisibility;
  createdAt: string;
};

export type RequestAssignee = {
  id: string;
  name: string;
  email?: string | null;
  image?: string | null;
  platformRole?: StaffRole | "CUSTOMER" | null;
};

export type RequestDetail = RequestListItem & {
  assignees?: RequestAssignee[];
  attachments: RequestAttachment[];
  messages: Array<{
    id: string;
    body: string;
    visibility: ContentVisibility;
    isSystem?: boolean;
    authorId: string;
    authorName: string;
    authorImage?: string | null;
    authorPlatformRole?: StaffRole | "CUSTOMER" | null;
    createdAt: string;
    attachments: RequestAttachment[];
  }>;
};

export type CustomerSpaceItem = {
  id: string;
  name: string;
  slug: string;
  memberLimit: number;
  status: "ACTIVE" | "SUSPENDED" | "ARCHIVED";
  ownerName: string;
  ownerEmail: string;
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
  categories: Array<{
    id: string;
    name: string;
    description?: string | null;
    active: boolean;
  }>;
};
