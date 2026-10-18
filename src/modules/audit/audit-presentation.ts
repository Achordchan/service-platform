import { statusLabelFor, type StatusValue } from "@/lib/status-config";
import { NOTIFICATION_DELIVERY_RULES } from "@/modules/notifications/notification-delivery-rules";
import type {
  AuditActorKind,
  AuditCategoryKey,
  AuditChangeView,
  AuditContextItem,
  AuditDeviceView,
  AuditObjectView,
} from "@/modules/audit/audit-types";

/**
 * 审计事件的「人话」展示层。
 *
 * 这里不放任何数据库依赖：服务端负责把资源名字查出来，本模块只负责把
 * action 码、metadata 与设备信息翻译成普通管理员能读懂的句子。这样同一套
 * 文案可以同时给 Web、小程序和测试复用。
 */

export const auditCategoryOrder: AuditCategoryKey[] = [
  "AUTH",
  "REQUEST",
  "PROJECT",
  "CUSTOMER",
  "TEAM",
  "SETTINGS",
  "SYSTEM",
  "OTHER",
];

const CATEGORY_LABELS: Record<AuditCategoryKey, string> = {
  AUTH: "登录与账号",
  REQUEST: "工单",
  PROJECT: "项目与文件",
  CUSTOMER: "客户",
  TEAM: "团队与权限",
  SETTINGS: "设置与集成",
  SYSTEM: "系统",
  OTHER: "其他",
};

// 顺序即优先级：先匹配的类目优先。例如 STAFF_PROFILE_ 归「团队与权限」，
// SUPPORT_PLAYBOOK_IMAGE_ 归「项目与文件」，而不是「设置与集成」。
const CATEGORY_PREFIXES: Array<[AuditCategoryKey, string[]]> = [
  ["AUTH", ["USER_", "PROFILE_", "WECHAT_", "APPEARANCE_", "NOTIFICATION_PREFERENCE_"]],
  ["TEAM", ["STAFF_", "ROLE_GROUP_"]],
  ["CUSTOMER", ["CUSTOMER_", "EXTERNAL_", "MEMBERSHIP_"]],
  ["REQUEST", ["REQUEST_"]],
  [
    "PROJECT",
    [
      "PROJECT_",
      "MILESTONE_",
      "UPDATE_COMMENT_",
      "ATTACHMENT_",
      "INLINE_IMAGE_",
      "SUPPORT_PLAYBOOK_IMAGE_",
    ],
  ],
  [
    "SETTINGS",
    [
      "PLATFORM_SETTINGS_",
      "SERVICE_TYPE_",
      "MAIL_",
      "SMTP_",
      "RESEND_",
      "NOTIFICATION_",
      "SUPPORT_PLAYBOOK_",
      "PLUGIN_",
      "UNIVERSAL_",
      "SUB2API_",
    ],
  ],
  ["SYSTEM", ["SYSTEM_"]],
];

/** 前缀的匹配优先级；查询层用它排除更高优先级类目的重叠前缀。 */
export const auditCategoryPrecedence: AuditCategoryKey[] =
  CATEGORY_PREFIXES.map(([key]) => key);

export function auditCategoryFor(action: string): AuditCategoryKey {
  for (const [key, prefixes] of CATEGORY_PREFIXES) {
    if (prefixes.some((prefix) => action.startsWith(prefix))) return key;
  }
  return "OTHER";
}

export function auditCategoryLabel(key: AuditCategoryKey): string {
  return CATEGORY_LABELS[key];
}

/** 某个类目包含的动作前缀，供查询层把「按类目筛选」翻译成 SQL 条件 */
export function auditCategoryPrefixes(key: AuditCategoryKey): string[] {
  return CATEGORY_PREFIXES.find(([candidate]) => candidate === key)?.[1] ?? [];
}

export const auditCategoryOptions = auditCategoryOrder.map((value) => ({
  value,
  label: CATEGORY_LABELS[value],
}));

export const PLATFORM_ROLE_LABELS: Record<string, string> = {
  PLATFORM_ADMIN: "平台管理员",
  PROJECT_MANAGER: "项目负责人",
  TECHNICIAN: "技术人员",
  CUSTOMER: "客户",
};

const PROJECT_STAFF_ROLE_LABELS: Record<string, string> = {
  PROJECT_MANAGER: "项目负责人",
  TECHNICIAN: "技术人员",
};

const PRIORITY_LABELS: Record<string, string> = {
  LOW: "低",
  NORMAL: "普通",
  HIGH: "高",
  URGENT: "紧急",
};

const VISIBILITY_LABELS: Record<string, string> = {
  INTERNAL: "仅内部可见",
  CUSTOMER_VISIBLE: "客户可见",
};

const DELIVERY_MODE_LABELS: Record<string, string> = {
  LOCAL_OUTBOX: "本地发件箱",
  RESEND: "Resend",
  SMTP: "SMTP",
};

const THEME_LABELS: Record<string, string> = {
  SYSTEM: "跟随系统",
  LIGHT: "浅色",
  DARK: "深色",
};

function yesNo(value: unknown): string | null {
  if (typeof value !== "boolean") return null;
  return value ? "开启" : "关闭";
}

function notificationRuleLabel(key: string | null): string | null {
  if (!key) return null;
  return (
    NOTIFICATION_DELIVERY_RULES.find((rule) => rule.key === key)?.label ?? key
  );
}

const SUBMITTED_FIELD_LABELS: Record<string, string> = {
  title: "标题",
  name: "名称",
  description: "描述",
  body: "正文",
  status: "状态",
  priority: "优先级",
  visibility: "可见范围",
  startDate: "开始日期",
  endDate: "结束日期",
  dueAt: "截止时间",
  serviceTypeId: "服务类型",
  categoryId: "分类",
  currentStage: "当前阶段",
  showMilestones: "显示里程碑",
  showProgress: "显示进度",
  customerUpdatesEnabled: "客户可看进度",
  customerRequestsEnabled: "客户可提工单",
  customerFilesEnabled: "客户可看文件",
  memberLimit: "成员上限",
  ownerId: "负责人",
  role: "角色",
  roleGroupId: "权限组",
  platformRole: "成员角色",
  accessLevel: "访问级别",
  permissions: "权限",
  active: "启用状态",
  email: "邮箱",
  sortOrder: "排序",
  themePreference: "主题偏好",
};

/** 这些动作的 metadata 是「本次提交的字段」，可以列出改了什么，而不泄露正文。 */
const SUBMITTED_FIELD_ACTIONS = new Set([
  "PROJECT_UPDATED",
  "MILESTONE_UPDATED",
  "PROJECT_UPDATE_UPDATED",
  "UPDATE_COMMENT_UPDATED",
  "MILESTONE_COMMENT_UPDATED",
  "CUSTOMER_SPACE_UPDATED",
  "SERVICE_TYPE_UPDATED",
  "REQUEST_CATEGORY_UPDATED",
  "ROLE_GROUP_UPDATED",
]);

function describeSubmittedFields(
  action: string,
  record: Record<string, unknown>,
): string[] {
  if (action === "SUPPORT_PLAYBOOK_UPDATED") {
    return Array.isArray(record.fields)
      ? record.fields
          .map((field) =>
            typeof field === "string"
              ? SUBMITTED_FIELD_LABELS[field] ?? null
              : null,
          )
          .filter((label): label is string => Boolean(label))
      : [];
  }
  if (!SUBMITTED_FIELD_ACTIONS.has(action)) return [];
  return Object.keys(record)
    .map((key) => SUBMITTED_FIELD_LABELS[key] ?? null)
    .filter((label): label is string => Boolean(label));
}

const STATUS_VALUES = new Set<string>([
  "DRAFT",
  "ACTIVE",
  "PAUSED",
  "COMPLETED",
  "EXPIRED",
  "NOT_STARTED",
  "IN_PROGRESS",
  "PENDING",
  "WAITING_CUSTOMER",
  "RESOLVED",
  "CLOSED",
]);

const LOGIN_METHOD_LABELS: Record<string, string> = {
  "/sign-in/email": "密码登录",
  "/sign-in/email-otp": "邮箱验证码",
  "/change-password": "改密后重登",
  "web-qr-login": "小程序扫码",
  miniapp: "小程序登录",
  "miniapp-bind": "微信绑定登录",
};

const LOGIN_FAILURE_LABELS: Record<string, string> = {
  INVALID_EMAIL_OR_PASSWORD: "邮箱或密码错误",
  EMAIL_NOT_FOUND: "邮箱未注册",
  EMAIL_NOT_VERIFIED: "邮箱尚未验证",
  INVALID_OTP: "验证码错误",
  OTP_EXPIRED: "验证码已过期",
  TOO_MANY_ATTEMPTS: "尝试次数过多",
  TURNSTILE_FAILED: "人机验证未通过",
  TOO_MANY_REQUESTS: "操作过于频繁",
};

const FILE_TYPE_LABELS: Record<string, string> = {
  "image/png": "PNG 图片",
  "image/jpeg": "JPEG 图片",
  "image/gif": "GIF 图片",
  "image/webp": "WebP 图片",
  "application/pdf": "PDF 文档",
  "text/plain": "文本文件",
  "text/csv": "CSV 表格",
  "application/json": "JSON 文件",
  "application/zip": "压缩包",
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asString(value: unknown): string | null {
  if (typeof value === "string") return value.trim() ? value : null;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return null;
}

export function statusText(value: string | null): string | null {
  if (!value) return null;
  const upper = value.toUpperCase();
  return STATUS_VALUES.has(upper) ? statusLabelFor(upper as StatusValue) : value;
}

function staffRoleText(value: string | null): string | null {
  if (!value) return null;
  return PROJECT_STAFF_ROLE_LABELS[value.toUpperCase()] ?? value;
}

function priorityText(value: string | null): string | null {
  if (!value) return null;
  return PRIORITY_LABELS[value.toUpperCase()] ?? value;
}

function visibilityText(value: string | null): string | null {
  if (!value) return null;
  return VISIBILITY_LABELS[value.toUpperCase()] ?? value;
}

function deliveryModeText(value: string | null): string | null {
  if (!value) return null;
  return DELIVERY_MODE_LABELS[value.toUpperCase()] ?? value;
}

export function platformRoleLabel(role: string | null | undefined): string | null {
  if (!role) return null;
  return PLATFORM_ROLE_LABELS[role] ?? role;
}

function fileTypeText(mimeType: string | null): string | null {
  if (!mimeType) return null;
  return FILE_TYPE_LABELS[mimeType] ?? mimeType;
}

export function formatFileSize(bytes: number | null | undefined): string | null {
  if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes < 0) return null;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

/**
 * 停留时长。时间来自登录/登出等审计事件，因此只说「约」并保留两个量级，
 * 不给出精确到秒的假象。
 */
export function formatDuration(ms: number | null | undefined, compact = false): string {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 60_000) return compact ? "< 1 分钟" : "不足 1 分钟";
  const totalMinutes = Math.round(ms / 60_000);
  if (totalMinutes < 60) return `${totalMinutes} 分钟`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours < 24) {
    if (compact) return minutes > 0 ? `${hours} 小时 ${minutes} 分` : `${hours} 小时`;
    return minutes > 0 ? `${hours} 小时 ${minutes} 分钟` : `${hours} 小时`;
  }
  const days = Math.floor(hours / 24);
  const restHours = hours % 24;
  return restHours > 0 ? `${days} 天 ${restHours} 小时` : `${days} 天`;
}

const BROWSER_RULES: Array<[RegExp, string]> = [
  [/MicroMessenger/i, "微信"],
  [/wxwork/i, "企业微信"],
  [/Edg\//i, "Edge"],
  [/OPR\/|Opera/i, "Opera"],
  [/Firefox\//i, "Firefox"],
  [/Chrome\//i, "Chrome"],
  [/Safari\//i, "Safari"],
  [/curl\//i, "命令行工具"],
  [/okhttp/i, "Android 应用"],
  [/PostmanRuntime/i, "Postman"],
  [/python-requests|python-urllib/i, "Python 程序"],
  [/node-fetch|undici/i, "服务端程序"],
];

const OS_RULES: Array<[RegExp, string]> = [
  [/Windows NT 10/i, "Windows"],
  [/Windows NT 6\.3/i, "Windows 8.1"],
  [/Windows NT 6\.1/i, "Windows 7"],
  [/Windows/i, "Windows"],
  [/iPhone|iPod/i, "iOS"],
  [/iPad/i, "iPadOS"],
  [/Mac OS X|Macintosh/i, "macOS"],
  [/HarmonyOS/i, "HarmonyOS"],
  [/Android/i, "Android"],
  [/CrOS/i, "ChromeOS"],
  [/Linux/i, "Linux"],
];

/** 把 User-Agent 翻译成「Chrome · macOS · 电脑」，不展示原始字符串。 */
export function describeUserAgent(userAgent: string | null | undefined): AuditDeviceView {
  if (!userAgent) {
    return { browser: null, os: null, deviceType: null, label: "未知设备" };
  }
  const browser = BROWSER_RULES.find(([pattern]) => pattern.test(userAgent))?.[1] ?? null;
  const os = OS_RULES.find(([pattern]) => pattern.test(userAgent))?.[1] ?? null;
  const deviceType =
    /iPad|Tablet/i.test(userAgent)
      ? "平板"
      : /Mobile|iPhone|Android|iPod/i.test(userAgent)
        ? "手机"
        : "电脑";
  const label = [browser, os, deviceType].filter(Boolean).join(" · ") || "其他设备";
  return { browser, os, deviceType, label };
}

const PRIVATE_IP_PATTERNS = [
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^169\.254\./,
  /^::1$/,
  /^f[cd][0-9a-f]{2}:/i,
  /^fe80:/i,
];

/** 不查 IP 归属地，只区分内网/公网，避免给管理员错误的地理信息。 */
export function ipScopeFor(ip: string | null | undefined): "PRIVATE" | "PUBLIC" | null {
  if (!ip) return null;
  // IPv4-mapped IPv6（::ffff:127.0.0.1）在 Node/代理下很常见，先剥掉前缀再判断
  const value = ip.trim().replace(/^::ffff:/i, "");
  if (!value) return null;
  return PRIVATE_IP_PATTERNS.some((pattern) => pattern.test(value)) ? "PRIVATE" : "PUBLIC";
}

export function loginMethodFor(metadata: unknown): string | null {
  const record = asRecord(metadata);
  const path = asString(record.path);
  if (!path) return null;
  // 绑定登录的 path 同为 miniapp-bind，要靠 method 区分「绑定码 / 账号验证」
  if (path === "miniapp-bind") {
    if (record.method === "code") return "微信绑定（绑定码）";
    if (record.method === "password") return "微信绑定（账号验证）";
  }
  return LOGIN_METHOD_LABELS[path] ?? null;
}

export function loginFailureReasonFor(metadata: unknown): string | null {
  const record = asRecord(metadata);
  const code = asString(record.code);
  if (!code) return null;
  return LOGIN_FAILURE_LABELS[code] ?? code;
}

function userNameOf(id: string | null, resolve?: (id: string) => string | null): string | null {
  if (!id || !resolve) return null;
  return resolve(id) || null;
}

function quoted(label: string | null, fallback: string) {
  return label ? `${fallback}「${label}」` : fallback;
}

type ChangeRule = {
  from: string;
  to: string;
  label: string;
  format?: (value: string | null) => string | null;
};

/** metadata 里常见的「变更前/变更后」成对字段。 */
function changeRules(
  resolveUserName?: (id: string) => string | null,
): ChangeRule[] {
  return [
    { from: "previousStatus", to: "status", label: "状态", format: statusText },
    { from: "previousStage", to: "currentStage", label: "项目阶段" },
    { from: "previousName", to: "name", label: "姓名" },
    { from: "previousRole", to: "role", label: "项目角色", format: staffRoleText },
    { from: "previousPriority", to: "priority", label: "优先级", format: priorityText },
    { from: "oldEmail", to: "newEmail", label: "邮箱" },
    {
      from: "previousAssigneeId",
      to: "assigneeId",
      label: "负责人",
      format: (value) => userNameOf(value, resolveUserName),
    },
    {
      from: "previousDeliveryMode",
      to: "deliveryMode",
      label: "发送方式",
      format: deliveryModeText,
    },
  ];
}

export function auditChanges(
  metadata: unknown,
  resolveUserName?: (id: string) => string | null,
): AuditChangeView[] {
  const record = asRecord(metadata);
  const changes: AuditChangeView[] = [];
  for (const rule of changeRules(resolveUserName)) {
    const from = asString(record[rule.from]);
    const to = asString(record[rule.to]);
    // 只有一边存在也算一次变更（例如首次指派没有「原负责人」）
    if (!from && !to) continue;
    if (from === to) continue;
    const format = rule.format ?? ((value: string | null) => value);
    changes.push({
      label: rule.label,
      from: from ? format(from) : null,
      to: to ? format(to) : null,
    });
  }
  return changes;
}

export type AuditPresentationInput = {
  action: string;
  actionLabel: string;
  resourceType: string;
  metadata: unknown;
  object: AuditObjectView | null;
  scope: AuditObjectView | null;
  actorKind: AuditActorKind;
  actorRoleLabel: string | null;
  resolveUserName?: (id: string) => string | null;
  resolveRoleGroupName?: (id: string) => string | null;
};

export type AuditPresentation = {
  summary: string;
  changes: AuditChangeView[];
  context: AuditContextItem[];
};

function actorIsCustomer(input: AuditPresentationInput) {
  return input.actorRoleLabel === "客户";
}

/**
 * 生成一句「做了什么」。不加执行人姓名——列表与详情都把执行人单独展示，
 * 句子只描述动作与对象。
 */
export function buildAuditPresentation(input: AuditPresentationInput): AuditPresentation {
  const { action, metadata, object, scope } = input;
  const record = asRecord(metadata);
  const changes = auditChanges(metadata, input.resolveUserName);
  const context: AuditContextItem[] = [];

  const objectLabel = object?.label ?? null;
  const scopeLabel = scope?.label ?? null;
  const targetUserId = asString(record.userId);

  const loginMethod = loginMethodFor(metadata);
  const failureReason = loginFailureReasonFor(metadata);
  const submittedFields = describeSubmittedFields(action, record);
  if (submittedFields.length > 0) {
    context.push({ label: "本次修改", value: submittedFields.join("、") });
  }

  if (action === "USER_LOGIN") {
    if (loginMethod) context.push({ label: "登录方式", value: loginMethod });
    return {
      summary: `登录了平台${loginMethod ? `（${loginMethod}）` : ""}`,
      changes,
      context,
    };
  }
  if (action === "USER_LOGOUT") {
    return { summary: "退出了登录", changes, context };
  }
  if (action === "USER_LOGIN_FAILED") {
    const attempted = asString(record.email);
    if (attempted) context.push({ label: "尝试的账号", value: attempted });
    if (failureReason) context.push({ label: "失败原因", value: failureReason });
    return {
      summary: `尝试登录，但${failureReason ?? "未通过验证"}`,
      changes,
      context,
    };
  }
  if (action === "USER_PASSWORD_RESET_REQUESTED") {
    return { summary: "提交了密码重置申请", changes, context };
  }
  if (action === "USER_PASSWORD_RESET_COMPLETED") {
    return {
      summary: "完成了密码重置，原有登录会话已失效",
      changes,
      context,
    };
  }
  if (action === "USER_EMAIL_CHANGE_REQUESTED") {
    const newEmail = asString(record.newEmail);
    return {
      summary: newEmail ? `申请将邮箱变更为 ${newEmail}` : "申请变更邮箱",
      changes,
      context,
    };
  }
  if (action === "USER_EMAIL_CHANGE_COMPLETED") {
    const oldEmail = asString(record.oldEmail);
    const newEmail = asString(record.newEmail);
    return {
      summary:
        oldEmail && newEmail
          ? `完成了邮箱变更（${oldEmail} → ${newEmail}）`
          : "完成了邮箱变更",
      changes,
      context,
    };
  }
  if (action === "USER_EMAIL_CHANGE_RESENT") {
    return { summary: "重新发送了邮箱变更验证邮件", changes, context };
  }
  if (action === "USER_EMAIL_CHANGE_CANCELLED") {
    return { summary: "取消了邮箱变更", changes, context };
  }

  if (action === "PROFILE_UPDATED") {
    const name = asString(record.name);
    if (name) context.push({ label: "新的姓名", value: name });
    return { summary: "更新了个人资料", changes, context };
  }
  if (action === "PROFILE_AVATAR_UPDATED") {
    return { summary: "更换了头像", changes, context };
  }
  if (action === "APPEARANCE_PREFERENCE_UPDATED") {
    const theme = asString(record.themePreference);
    if (theme) {
      context.push({ label: "主题", value: THEME_LABELS[theme] ?? theme });
    }
    return { summary: "调整了界面显示偏好", changes, context };
  }
  if (action === "NOTIFICATION_PREFERENCES_UPDATED") {
    const sound = yesNo(record.soundNotificationsEnabled);
    if (sound) context.push({ label: "声音提醒", value: sound });
    const mail = yesNo(record.requestEmailNotificationsEnabled);
    if (mail) context.push({ label: "邮件提醒", value: mail });
    return { summary: "更新了通知偏好", changes, context };
  }
  if (action === "NOTIFICATION_PREFERENCE_TYPE_UPDATED") {
    const ruleKey = notificationRuleLabel(asString(record.ruleKey));
    if (ruleKey) context.push({ label: "通知类型", value: ruleKey });
    const mail = yesNo(record.emailEnabled);
    if (mail) context.push({ label: "邮件提醒", value: mail });
    return { summary: "更新了通知偏好", changes, context };
  }
  if (action === "STAFF_PROFILE_UPDATED") {
    const roleGroupId = asString(record.roleGroupId);
    const roleGroupName = roleGroupId
      ? input.resolveRoleGroupName?.(roleGroupId) ?? null
      : null;
    if (roleGroupName) context.push({ label: "权限组", value: roleGroupName });
    const platformRole = platformRoleLabel(asString(record.platformRole));
    if (platformRole) context.push({ label: "成员角色", value: platformRole });
    return {
      summary: objectLabel ? `调整了成员「${objectLabel}」的角色与权限` : "调整了成员角色与权限",
      changes,
      context,
    };
  }
  if (action === "STAFF_USER_DELETED") {
    const name = asString(record.name) ?? objectLabel;
    return { summary: name ? `删除了成员账号「${name}」` : "删除了成员账号", changes, context };
  }
  if (action === "STAFF_INVITATION_CREATED") {
    const email = asString(record.email);
    const role = platformRoleLabel(asString(record.platformRole));
    if (role) context.push({ label: "成员角色", value: role });
    return {
      summary: email ? `邀请了 ${email} 加入团队` : "发出了团队邀请",
      changes,
      context,
    };
  }
  if (action === "STAFF_INVITATION_REVOKED") {
    return { summary: "撤销了团队邀请", changes, context };
  }
  if (action === "STAFF_INVITATION_ACCEPTED") {
    return { summary: "接受了邀请并加入团队", changes, context };
  }
  if (action === "ROLE_GROUP_CREATED" || action === "ROLE_GROUP_UPDATED") {
    const name = objectLabel ?? asString(record.name) ?? asString(record.key);
    return {
      summary: name ? `${action === "ROLE_GROUP_CREATED" ? "创建" : "更新"}了权限组「${name}」` : "调整了权限组",
      changes,
      context,
    };
  }
  if (action === "ROLE_GROUP_DELETED") {
    const name = objectLabel ?? asString(record.name) ?? asString(record.key);
    return { summary: name ? `删除了权限组「${name}」` : "删除了权限组", changes, context };
  }

  if (action === "REQUEST_CREATED") {
    const priority = priorityText(asString(record.priority));
    if (priority) context.push({ label: "优先级", value: priority });
    return {
      summary: `${actorIsCustomer(input) ? "提交" : "创建"}了${quoted(objectLabel, "工单")}`,
      changes,
      context,
    };
  }
  if (action === "REQUEST_STATUS_CHANGED") {
    const statusChange = changes.find((item) => item.label === "状态");
    const source = asString(record.source);
    if (source === "AUTO_CLOSE_AFTER_RESOLUTION") {
      context.push({ label: "触发方式", value: "已解决后长期无回复，系统自动关闭" });
    }
    return {
      summary: statusChange?.to
        ? statusChange.from
          ? `将${quoted(objectLabel, "工单")}的状态从「${statusChange.from}」改为「${statusChange.to}」`
          : `将${quoted(objectLabel, "工单")}的状态改为「${statusChange.to}」`
        : `变更了${quoted(objectLabel, "工单")}的状态`,
      changes,
      context,
    };
  }
  if (action === "REQUEST_ASSIGNED") {
    const assignee = userNameOf(asString(record.assigneeId), input.resolveUserName);
    return {
      summary: assignee
        ? `将${quoted(objectLabel, "工单")}指派给 ${assignee}`
        : `变更了${quoted(objectLabel, "工单")}的负责人`,
      changes,
      context,
    };
  }
  if (action === "REQUEST_AUTO_CLAIMED") {
    return {
      summary: `接手了${quoted(objectLabel, "工单")}（首条回复自动认领）`,
      changes,
      context,
    };
  }
  if (action === "REQUEST_ARCHIVED") {
    return { summary: `归档了${quoted(objectLabel, "工单")}`, changes, context };
  }
  if (action === "REQUEST_RESTORED") {
    return { summary: `恢复了${quoted(objectLabel, "工单")}`, changes, context };
  }
  if (action === "REQUEST_MESSAGE_CREATED") {
    return {
      summary: actorIsCustomer(input)
        ? `在${quoted(objectLabel, "工单")}中回复了消息`
        : `回复了${quoted(objectLabel, "工单")}`,
      changes,
      context,
    };
  }
  if (action === "REQUEST_INTERNAL_NOTE_CREATED") {
    return {
      summary: `在${quoted(objectLabel, "工单")}中添加了内部备注`,
      changes,
      context,
    };
  }
  if (action === "REQUEST_MESSAGE_REVOKED") {
    return { summary: `撤回了${quoted(objectLabel, "工单")}中的一条消息`, changes, context };
  }

  if (action === "PROJECT_CREATED") {
    return { summary: `创建了${quoted(objectLabel, "项目")}`, changes, context };
  }
  if (action === "PROJECT_UPDATED") {
    return { summary: `更新了${quoted(objectLabel, "项目")}`, changes, context };
  }
  if (action === "PROJECT_DELETED") {
    const title = objectLabel ?? asString(record.title);
    return { summary: title ? `删除了项目「${title}」` : "删除了项目", changes, context };
  }
  if (action === "PROJECT_STAGE_UPDATED") {
    const previous = asString(record.previousStage);
    const current = asString(record.currentStage);
    return {
      summary:
        previous && current
          ? `将${quoted(objectLabel, "项目")}的阶段从「${previous}」调整为「${current}」`
          : `变更了${quoted(objectLabel, "项目")}的阶段`,
      changes,
      context,
    };
  }
  if (action === "PROJECT_STAFF_ADDED" || action === "PROJECT_STAFF_REMOVED") {
    const member = userNameOf(targetUserId, input.resolveUserName);
    const project = quoted(objectLabel, "项目");
    if (action === "PROJECT_STAFF_ADDED") {
      return {
        summary: member ? `将 ${member} 加入${project}` : `在${project}中添加了成员`,
        changes,
        context,
      };
    }
    return {
      summary: member ? `将 ${member} 移出${project}` : `从${project}中移除了成员`,
      changes,
      context,
    };
  }
  if (action === "PROJECT_STAFF_UPDATED") {
    const member = userNameOf(targetUserId, input.resolveUserName);
    return {
      summary: member
        ? `调整了 ${member} 在${quoted(objectLabel, "项目")}中的角色`
        : `调整了${quoted(objectLabel, "项目")}中的成员角色`,
      changes,
      context,
    };
  }
  if (action === "MILESTONE_CREATED" || action === "MILESTONE_UPDATED" || action === "MILESTONE_DELETED") {
    const milestone = quoted(objectLabel, "里程碑");
    const where = scopeLabel ? `在项目「${scopeLabel}」中` : "";
    const verb = action === "MILESTONE_CREATED" ? "创建" : action === "MILESTONE_UPDATED" ? "更新" : "删除";
    return { summary: `${where}${verb}了${milestone}`, changes, context };
  }
  if (action.startsWith("MILESTONE_COMMENT_")) {
    const where = objectLabel ? `里程碑「${objectLabel}」` : "里程碑";
    const verb = action.endsWith("_CREATED")
      ? "发表了评论"
      : action.endsWith("_UPDATED")
        ? "编辑了评论"
        : "删除了评论";
    return { summary: `在${where}中${verb}`, changes, context };
  }
  if (action === "PROJECT_UPDATE_CREATED" || action === "PROJECT_UPDATE_UPDATED" || action === "PROJECT_UPDATE_DELETED") {
    const title = objectLabel;
    const where = scopeLabel ? `在项目「${scopeLabel}」中` : "";
    const verb = action === "PROJECT_UPDATE_CREATED" ? "发布" : action === "PROJECT_UPDATE_UPDATED" ? "编辑" : "删除";
    return {
      summary: `${where}${verb}了项目进度${title ? `「${title}」` : ""}`,
      changes,
      context,
    };
  }
  if (action.startsWith("UPDATE_COMMENT_")) {
    const verb = action.endsWith("_CREATED")
      ? "评论"
      : action.endsWith("_UPDATED")
        ? "编辑"
        : "删除";
    return {
      summary: `在${quoted(scopeLabel, "项目")}中${verb}了项目进度评论`,
      changes,
      context,
    };
  }

  if (
    action.startsWith("ATTACHMENT_") ||
    action === "INLINE_IMAGE_UPLOADED" ||
    action === "SUPPORT_PLAYBOOK_IMAGE_UPLOADED" ||
    action === "PROJECT_ATTACHMENT_FILE_DELETE_FAILED"
  ) {
    const fileName = objectLabel ?? asString(record.originalName);
    const rawSize = asString(record.size);
    const size = formatFileSize(
      typeof record.size === "number" ? record.size : rawSize ? Number(rawSize) : null,
    );
    const mimeType = fileTypeText(asString(record.mimeType));
    if (mimeType) context.push({ label: "文件类型", value: mimeType });
    if (size) context.push({ label: "文件大小", value: size });

    const uploaded = `上传了${fileName ? `文件「${fileName}」` : "附件"}`;
    const summary = (() => {
      switch (action) {
        case "ATTACHMENT_UPLOADED":
          return uploaded;
        case "INLINE_IMAGE_UPLOADED":
          return "在内容中插入了图片";
        case "SUPPORT_PLAYBOOK_IMAGE_UPLOADED":
          return "上传了回复模板图片";
        case "ATTACHMENT_DOWNLOADED":
          return `下载了${fileName ? `文件「${fileName}」` : "附件"}`;
        case "ATTACHMENT_PINNED_TO_PROJECT":
          return `将${fileName ? `文件「${fileName}」` : "附件"}加入了项目文件`;
        case "ATTACHMENT_UNPINNED_FROM_PROJECT":
          return `将${fileName ? `文件「${fileName}」` : "附件"}移出了项目文件`;
        case "PROJECT_ATTACHMENT_DELETED":
          return `删除了${fileName ? `项目文件「${fileName}」` : "项目文件"}`;
        case "PROJECT_ATTACHMENT_FILE_DELETE_FAILED":
          return `项目文件清理失败${fileName ? `（${fileName}）` : ""}`;
        default:
          return uploaded;
      }
    })();
    return { summary, changes, context };
  }

  if (action === "CUSTOMER_SPACE_CREATED" || action === "CUSTOMER_SPACE_UPDATED" || action === "CUSTOMER_SPACE_DELETED") {
    const name = objectLabel ?? asString(record.name);
    const verb = action === "CUSTOMER_SPACE_CREATED" ? "创建" : action === "CUSTOMER_SPACE_UPDATED" ? "更新" : "删除";
    return {
      summary: name ? `${verb}了客户空间「${name}」` : `${verb}了客户空间`,
      changes,
      context,
    };
  }
  if (action === "CUSTOMER_SPACE_MEMBER_REMOVED") {
    const member = userNameOf(targetUserId, input.resolveUserName) ?? asString(record.email);
    return {
      summary: member ? `将 ${member} 移出了客户空间` : "移除了客户空间成员",
      changes,
      context,
    };
  }
  if (action === "CUSTOMER_SPACE_INVITATION_CREATED") {
    const email = asString(record.email);
    return {
      summary: email ? `邀请 ${email} 加入客户空间` : "发出了客户空间邀请",
      changes,
      context,
    };
  }
  if (action === "CUSTOMER_SPACE_INVITATION_REVOKED") {
    const email = asString(record.email);
    return {
      summary: email ? `撤销了发给 ${email} 的邀请` : "撤销了客户空间邀请",
      changes,
      context,
    };
  }
  if (action === "CUSTOMER_SPACE_INVITATION_ACCEPTED") {
    return {
      summary: `${quoted(objectLabel, "客户空间")}的邀请已被接受`,
      changes,
      context,
    };
  }
  if (action === "CUSTOMER_ACCOUNT_UPDATED" || action === "CUSTOMER_ACCOUNT_DELETED") {
    const name = objectLabel ?? asString(record.name);
    const verb = action === "CUSTOMER_ACCOUNT_UPDATED" ? "更新" : "删除";
    return {
      summary: name ? `${verb}了客户账号「${name}」` : `${verb}了客户账号`,
      changes,
      context,
    };
  }
  if (action === "EXTERNAL_CONTACT_STATUS_UPDATED") {
    const status = asString(record.status);
    return {
      summary: status ? `将外部联系人状态改为「${status}」` : "更新了外部联系人状态",
      changes,
      context,
    };
  }

  if (action === "SMTP_PROVIDER_CHECKED" || action === "SMTP_PROVIDER_DISCONNECTED") {
    const host = asString(record.host);
    if (host) context.push({ label: "邮件服务器", value: host });
    return {
      summary: action === "SMTP_PROVIDER_CHECKED" ? "检查了 SMTP 发件通道" : "断开了 SMTP 发件通道",
      changes,
      context,
    };
  }
  if (action.startsWith("RESEND_")) {
    const domain = asString(record.domain);
    if (domain) context.push({ label: "发件域名", value: domain });
  }
  if (action === "PLATFORM_SETTINGS_UPDATED") {
    const mailMode = deliveryModeText(asString(record.mailMode));
    if (mailMode) context.push({ label: "邮件发送方式", value: mailMode });
    const appUrl = asString(record.appUrl);
    if (appUrl) context.push({ label: "站点地址", value: appUrl });
    if (record.passwordChanged === true) {
      context.push({ label: "邮件密码", value: "已更新" });
    }
  }
  if (action === "SYSTEM_ERROR_LOG_EXPORTED") {
    const rowCount = asString(record.rowCount);
    return {
      summary: rowCount ? `导出了系统报错日志（${rowCount} 条）` : "导出了系统报错日志",
      changes,
      context,
    };
  }

  // 兜底：动作名本身已是中文短语；对象名放到「对象」列，不硬拼成病句。
  const visibility = visibilityText(asString(record.visibility));
  if (visibility) context.push({ label: "可见范围", value: visibility });
  return {
    summary: actionLabelFallback(input.actionLabel, objectLabel),
    changes,
    context,
  };
}

function actionLabelFallback(actionLabel: string, objectLabel: string | null) {
  if (!objectLabel) return actionLabel;
  // 标签里已经带对象名（如「创建项目」）时不重复追加，避免「创建项目（项目）」
  return actionLabel.includes(objectLabel) ? actionLabel : `${actionLabel}（${objectLabel}）`;
}
