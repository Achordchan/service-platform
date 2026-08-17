/**
 * Audit actions are stored as `<RESOURCE>_<VERB>` codes written at 128 call
 * sites. Rather than maintain a lookup for every code (which would drift as new
 * ones are added), the trailing verb is translated and the raw code is always
 * shown alongside it.
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

/** Chinese verb for an action code, or `null` when the suffix is unknown. */
export function auditActionVerb(action: string): string | null {
  const suffix = action.slice(action.lastIndexOf("_") + 1);
  return verbLabels[suffix] ?? verbLabels[action] ?? null;
}

/** Chinese name for a resource type, falling back to the raw value. */
export function auditResourceLabel(resourceType: string): string {
  return resourceLabels[resourceType] ?? resourceType;
}
