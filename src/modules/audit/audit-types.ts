/**
 * 审计日志在展示层的统一形状。Web 与小程序共用（小程序只消费其中一部分），
 * 因此这里只放纯类型，不引入任何服务端依赖。
 */

export type AuditCategoryKey =
  | "AUTH"
  | "REQUEST"
  | "PROJECT"
  | "CUSTOMER"
  | "TEAM"
  | "SETTINGS"
  | "SYSTEM"
  | "OTHER";

export type AuditActorKind = "USER" | "EXTERNAL" | "ANONYMOUS" | "SYSTEM";

export type AuditActorView = {
  kind: AuditActorKind;
  /** 平台用户或外部联系人 ID；未认证访客/系统为空 */
  id: string | null;
  name: string;
  email: string | null;
  /** 平台角色或角色组名称，例如「平台管理员」「项目负责人」 */
  roleLabel: string | null;
};

export type AuditDeviceView = {
  browser: string | null;
  os: string | null;
  deviceType: string | null;
  /** 「Chrome · macOS · 电脑」；解析不出时是「未知设备」 */
  label: string;
};

export type AuditChangeView = {
  label: string;
  /** 变更前；新建/未知时为空 */
  from: string | null;
  /** 变更后；清空时为空 */
  to: string | null;
};

export type AuditObjectView = {
  label: string;
  typeLabel: string;
  href: string | null;
};

export type AuditContextItem = {
  label: string;
  value: string;
};

export type AuditLogRow = {
  id: string;
  action: string;
  actionLabel: string;
  category: AuditCategoryKey;
  categoryLabel: string;
  resourceType: string;
  resourceLabel: string;
  resourceId: string | null;
  result: string;
  resultLabel: string;
  createdAt: string;
  actorName: string | null;
  actorEmail: string | null;
  externalActorName: string | null;
  /** 小程序直接渲染的兼容字段（保持原形状） */
  actorDisplay: { name: string; secondary: string };
  actor: AuditActorView;
  ipAddress: string | null;
  ipScope: "PRIVATE" | "PUBLIC" | null;
  userAgent: string | null;
  device: AuditDeviceView;
  /** 一句普通话：「将工单 #1001「打印机故障」的状态从「处理中」改为「已解决」」 */
  summary: string;
  object: AuditObjectView | null;
  /** 对象所属的项目/客户空间，便于展示「所属项目」与跳转 */
  scope: AuditObjectView | null;
  changes: AuditChangeView[];
  context: AuditContextItem[];
  metadata: unknown;
  projectId: string | null;
  customerSpaceId: string | null;
  serviceRequestId: string | null;
};

export type AuditLogPage = {
  rows: AuditLogRow[];
  total: number;
  page: number;
  pageSize: number;
};

export type AuditFacetOption = { value: string; label: string };

export type AuditActorFacetOption = AuditFacetOption & {
  secondary: string | null;
};

export type AuditFacets = {
  actions: string[];
  resourceTypes: string[];
  results: string[];
  actionOptions?: AuditFacetOption[];
  resourceTypeOptions?: AuditFacetOption[];
  resultOptions?: AuditFacetOption[];
  actors?: AuditActorFacetOption[];
};

export type AuditRangePreset = "today" | "7d" | "30d" | "custom";

export type AuditRange = {
  preset: AuditRangePreset;
  from: string;
  to: string;
};

/** 一次登录会话；由登录/登出审计配对得出 */
export type AuditSessionView = {
  key: string;
  startedAt: string;
  endedAt: string | null;
  durationMs: number | null;
  /** LOGGED_OUT 正常登出；ACTIVE 仍在登录；STALE 未登出（按最后操作估算）；UNKNOWN 无法判断 */
  endReason: "LOGGED_OUT" | "ACTIVE" | "STALE" | "UNKNOWN";
  endReasonLabel: string;
  ipAddress: string | null;
  device: AuditDeviceView;
  loginMethod: string | null;
};

export type AuditPersonActivityRow = {
  id: string;
  name: string;
  email: string;
  roleLabel: string;
  kind: "USER";
  isOnline: boolean;
  lastActiveAt: string | null;
  lastLoginAt: string | null;
  loginCount: number;
  actionCount: number;
  sessionCount: number;
  totalDurationMs: number;
  /** 未正常登出的会话：按最后操作估算，仅展示，不进入平均 */
  estimatedDurationMs: number;
  avgDurationMs: number | null;
  lastIpAddress: string | null;
  lastDevice: AuditDeviceView | null;
};

export type AuditPeoplePage = {
  rows: AuditPersonActivityRow[];
  total: number;
  activeWindowDays: number;
};

export type AuditOverview = {
  from: string;
  to: string;
  totals: {
    actionCount: number;
    activePeople: number;
    loginCount: number;
    failedLoginCount: number;
    sessionCount: number;
    avgSessionMs: number | null;
    onlineNow: number;
  };
  trend: Array<{ date: string; actions: number; activePeople: number; logins: number }>;
  recentLogins: AuditLogRow[];
  recentEvents: AuditLogRow[];
  topPeople: Array<{
    id: string;
    name: string;
    email: string;
    roleLabel: string;
    actionCount: number;
    lastActiveAt: string;
  }>;
  onlineSessions: Array<{
    sessionId: string;
    userId: string;
    name: string;
    email: string;
    roleLabel: string;
    startedAt: string;
    durationMs: number;
    ipAddress: string | null;
    device: AuditDeviceView;
  }>;
  notices: Array<{
    key: string;
    tone: "info" | "warning";
    title: string;
    description: string;
  }>;
};

export type AuditPersonDetail = {
  person: {
    id: string;
    name: string;
    email: string;
    roleLabel: string;
    isOnline: boolean;
    lastActiveAt: string | null;
    lastLoginAt: string | null;
  };
  from: string;
  to: string;
  totals: {
    actionCount: number;
    loginCount: number;
    sessionCount: number;
    totalDurationMs: number;
    /** 未正常登出会话的估算时长（单列展示，不进入平均） */
    estimatedDurationMs: number;
    avgDurationMs: number | null;
  };
  currentSessions: Array<{
    sessionId: string;
    startedAt: string;
    durationMs: number;
    expiresAt: string;
    ipAddress: string | null;
    device: AuditDeviceView;
  }>;
  sessions: AuditSessionView[];
  breakdown: Array<{ category: AuditCategoryKey; categoryLabel: string; count: number }>;
  timeline: AuditLogPage;
};
