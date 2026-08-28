/**
 * Audit actions are stored as `<RESOURCE>_<VERB>` codes. For the admin-facing
 * log we translate each known code to a full Chinese phrase via `actionLabels`,
 * and fall back to translating the trailing verb + resource type for any code
 * not yet mapped (so newly added codes still render something readable instead
 * of a raw variable). The raw code is always shown alongside for engineers.
 */
const verbLabels: Record<string, string> = {
  CREATED: "创建",
  UPDATED: "更新",
  DELETED: "删除",
  REMOVED: "移除",
  ADDED: "添加",
  ASSIGNED: "指派",
  CLAIMED: "认领",
  ACCEPTED: "接受",
  REVOKED: "撤销",
  CANCELLED: "取消",
  ARCHIVED: "归档",
  RESTORED: "恢复",
  RESET: "重置",
  COMPLETED: "完成",
  CHANGED: "变更",
  CHECKED: "检查",
  CONFIGURED: "配置",
  DISCONNECTED: "断开",
  DOWNLOADED: "下载",
  UPLOADED: "上传",
  SENT: "发送",
  RESENT: "重发",
  REQUEUED: "重新入队",
  REQUESTED: "请求",
  VERIFIED: "验证",
  FAILED: "失败",
  DELETE: "删除",
  BOUND: "绑定",
  LOGIN: "登录",
  LOGOUT: "登出",
  PAUSE: "暂停",
  RESUME: "恢复",
  CANCEL: "取消",
};

const resourceLabels: Record<string, string> = {
  Attachment: "附件",
  ATTACHMENT: "附件",
  CustomerSpace: "客户空间",
  ExternalContact: "外部联系人",
  ExternalEmbedSession: "外部会话",
  Invitation: "邀请",
  MailMessage: "邮件",
  MailTemplateOverride: "邮件模板",
  Membership: "成员关系",
  Milestone: "里程碑",
  NotificationDeliveryRule: "通知规则",
  PlatformSetting: "平台设置",
  PluginInstallation: "插件安装",
  PluginRun: "插件运行",
  Project: "项目",
  ProjectStaff: "项目成员",
  ProjectUpdate: "项目进度",
  RequestCategory: "请求分类",
  RequestMessage: "请求消息",
  RoleGroup: "角色组",
  ServiceRequest: "服务请求",
  ServiceType: "服务类型",
  StaffInvitation: "员工邀请",
  Sub2ApiConnection: "Sub2Api 连接",
  SupportPlaybook: "回复模板",
  UniversalConnectorConnection: "通用连接器",
  UniversalConnectorCredential: "连接器凭据",
  UpdateComment: "进度评论",
  User: "用户",
  UserEmailChange: "邮箱变更",
  WechatBinding: "微信绑定",
  WechatBindingCode: "微信绑定码",
};

/**
 * Full Chinese phrase for each known audit action code. Keep in sync with the
 * ~90 `writeAuditLog` / `recordAuthEvent` call sites; unmapped codes degrade to
 * the resource+verb fallback in `auditActionLabel`.
 */
const actionLabels: Record<string, string> = {
  // 认证
  USER_LOGIN: "登录",
  USER_LOGOUT: "登出",
  USER_LOGIN_FAILED: "登录失败",
  USER_PASSWORD_RESET_REQUESTED: "发起密码重置",

  // 项目
  PROJECT_CREATED: "创建项目",
  PROJECT_UPDATED: "更新项目",
  PROJECT_DELETED: "删除项目",
  PROJECT_STAGE_UPDATED: "变更项目阶段",
  PROJECT_STAFF_ADDED: "添加项目成员",
  PROJECT_STAFF_UPDATED: "调整项目成员",
  PROJECT_STAFF_REMOVED: "移除项目成员",
  PROJECT_UPDATE_CREATED: "发布项目进度",
  PROJECT_UPDATE_UPDATED: "编辑项目进度",
  PROJECT_UPDATE_DELETED: "删除项目进度",
  PROJECT_ATTACHMENT_UPLOADED: "上传项目附件",
  UPDATE_COMMENT_CREATED: "发表进度评论",
  UPDATE_COMMENT_UPDATED: "编辑进度评论",
  MILESTONE_CREATED: "创建里程碑",
  MILESTONE_UPDATED: "更新里程碑",
  MILESTONE_DELETED: "删除里程碑",

  // 工单
  REQUEST_CREATED: "创建工单",
  REQUEST_AUTO_CLAIMED: "自动认领工单",
  REQUEST_ASSIGNED: "指派工单",
  REQUEST_ARCHIVED: "归档工单",
  REQUEST_RESTORED: "恢复工单",
  REQUEST_STATUS_CHANGED: "变更工单状态",
  REQUEST_MESSAGE_CREATED: "发送工单消息",
  REQUEST_INTERNAL_NOTE_CREATED: "添加内部备注",
  REQUEST_MESSAGE_REVOKED: "撤回工单消息",

  // 服务类型 / 分类
  SERVICE_TYPE_CREATED: "创建服务类型",
  SERVICE_TYPE_UPDATED: "更新服务类型",
  SERVICE_TYPE_DELETED: "删除服务类型",
  REQUEST_CATEGORY_CREATED: "创建请求分类",
  REQUEST_CATEGORY_UPDATED: "更新请求分类",
  REQUEST_CATEGORY_DELETED: "删除请求分类",

  // 客户空间 / 账号
  CUSTOMER_SPACE_CREATED: "创建客户空间",
  CUSTOMER_SPACE_UPDATED: "更新客户空间",
  CUSTOMER_SPACE_DELETED: "删除客户空间",
  CUSTOMER_SPACE_MEMBER_REMOVED: "移除空间成员",
  CUSTOMER_SPACE_INVITATION_CREATED: "创建客户邀请",
  CUSTOMER_SPACE_INVITATION_REVOKED: "撤销客户邀请",
  CUSTOMER_SPACE_INVITATION_ACCEPTED: "接受客户邀请",
  CUSTOMER_ACCOUNT_UPDATED: "更新客户账号",
  CUSTOMER_ACCOUNT_DELETED: "删除客户账号",

  // 员工 / 用户 / 权限
  STAFF_INVITATION_CREATED: "创建员工邀请",
  STAFF_INVITATION_ACCEPTED: "接受员工邀请",
  STAFF_INVITATION_REVOKED: "撤销员工邀请",
  STAFF_PROFILE_UPDATED: "更新员工资料",
  STAFF_USER_DELETED: "删除员工账号",
  PROFILE_UPDATED: "更新个人资料",
  PROFILE_AVATAR_UPDATED: "更新头像",
  ROLE_GROUP_CREATED: "创建角色组",
  ROLE_GROUP_UPDATED: "更新角色组",
  ROLE_GROUP_DELETED: "删除角色组",
  APPEARANCE_PREFERENCE_UPDATED: "更新外观偏好",
  NOTIFICATION_PREFERENCE_TYPE_UPDATED: "更新单项通知偏好",
  NOTIFICATION_PREFERENCES_UPDATED: "更新通知偏好",
  USER_EMAIL_CHANGE_REQUESTED: "发起邮箱变更",
  USER_EMAIL_CHANGE_RESENT: "重发邮箱变更验证",
  USER_EMAIL_CHANGE_COMPLETED: "完成邮箱变更",
  USER_EMAIL_CHANGE_CANCELLED: "取消邮箱变更",

  // 附件
  ATTACHMENT_UPLOADED: "上传附件",
  INLINE_IMAGE_UPLOADED: "上传内嵌图片",
  ATTACHMENT_DOWNLOADED: "下载附件",
  SUPPORT_PLAYBOOK_IMAGE_UPLOADED: "上传回复模板图片",

  // 平台设置 / 邮件
  PLATFORM_SETTINGS_UPDATED: "更新平台设置",
  MAIL_TEMPLATE_UPDATED: "更新邮件模板",
  MAIL_TEMPLATE_RESET: "重置邮件模板",
  MAIL_MESSAGE_REQUEUED: "重新入队邮件",
  MAIL_MESSAGE_CANCELLED: "取消邮件",
  SMTP_PROVIDER_CHECKED: "检查 SMTP 通道",
  SMTP_PROVIDER_DISCONNECTED: "断开 SMTP 通道",
  RESEND_PROVIDER_CONFIGURED: "配置 Resend 通道",
  RESEND_PROVIDER_DISCONNECTED: "断开 Resend 通道",
  RESEND_DOMAIN_VERIFIED: "验证 Resend 域名",
  RESEND_WEBHOOK_REMOVE_FAILED: "移除 Resend Webhook 失败",
  NOTIFICATION_DELIVERY_RULES_UPDATED: "更新通知送达规则",

  // 插件
  PLUGIN_INSTALLATION_UPDATED: "更新插件安装",
  PLUGIN_HEALTH_CHECKED: "检查插件健康",
  PLUGIN_HISTORY_RUN_CREATED: "创建插件运行记录",
  PLUGIN_TEST_MESSAGE_SENT: "发送插件测试消息",
  // 动态拼装：`PLUGIN_RUN_${action.toUpperCase()}`，action ∈ pause/resume/cancel
  PLUGIN_RUN_PAUSE: "暂停插件运行",
  PLUGIN_RUN_RESUME: "恢复插件运行",
  PLUGIN_RUN_CANCEL: "取消插件运行",

  // 回复模板
  SUPPORT_PLAYBOOK_CREATED: "创建回复模板",
  SUPPORT_PLAYBOOK_UPDATED: "更新回复模板",
  SUPPORT_PLAYBOOK_ARCHIVED: "归档回复模板",
  SUPPORT_PLAYBOOK_RESTORED: "恢复回复模板",
  SUPPORT_PLAYBOOK_RESET: "重置回复模板",

  // 微信 / 小程序
  WECHAT_BINDING_CODE_CREATED: "生成微信绑定码",
  WECHAT_BINDING_CODE_REVOKED: "撤销微信绑定码",
  WECHAT_BINDING_REMOVED: "解除微信绑定",
  WECHAT_BOUND_VIA_CODE: "微信绑定（绑定码）",
  WECHAT_BOUND_VIA_ACCOUNT: "微信绑定（账号验证）",

  // 集成 / 外部嵌入
  UNIVERSAL_CONNECTION_CHECKED: "检查通用连接器",
  UNIVERSAL_CONNECTION_ARCHIVED: "归档通用连接器",
  UNIVERSAL_CREDENTIAL_CREATED: "创建连接器凭据",
  UNIVERSAL_CREDENTIAL_REVOKED: "撤销连接器凭据",
  UNIVERSAL_EMBED_SESSION_CREATED: "创建外部嵌入会话",
  SUB2API_CONNECTION_CHECKED: "检查 Sub2Api 连接",
  SUB2API_CONNECTION_ARCHIVED: "归档 Sub2Api 连接",
  SUB2API_EMBED_SESSION_CREATED: "创建 Sub2Api 会话",
  EXTERNAL_CONTACT_STATUS_UPDATED: "更新外部联系人状态",
};

/**
 * 未认证来源的动作：无已认证操作者（actorId 为空）。展示端据此把空 actor 归类为
 * 「未认证访客」，而非误当作系统/自动任务。
 */
const UNAUTHENTICATED_ACTIONS = new Set<string>([
  "USER_LOGIN_FAILED",
  "USER_PASSWORD_RESET_REQUESTED",
]);

export function isUnauthenticatedAuditAction(action: string): boolean {
  return UNAUTHENTICATED_ACTIONS.has(action);
}

/** Chinese verb for an action code, or `null` when the suffix is unknown. */
export function auditActionVerb(action: string): string | null {
  const suffix = action.slice(action.lastIndexOf("_") + 1);
  return verbLabels[suffix] ?? verbLabels[action] ?? null;
}

/** Chinese name for a resource type, falling back to the raw value. */
export function auditResourceLabel(resourceType: string): string {
  return resourceLabels[resourceType] ?? resourceType;
}

/**
 * Full human-readable Chinese label for an audit action. Prefers the explicit
 * per-code phrase; otherwise falls back to `<资源> · <动词>` when the resource
 * type is known, then to the bare verb, and finally the raw code.
 */
export function auditActionLabel(
  action: string,
  resourceType?: string,
): string {
  const explicit = actionLabels[action];
  if (explicit) return explicit;
  const verb = auditActionVerb(action);
  if (resourceType) {
    const resource = auditResourceLabel(resourceType);
    return verb ? `${resource} · ${verb}` : resource;
  }
  return verb ?? action;
}
