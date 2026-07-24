import { z } from "zod";

export const NOTIFICATION_DELIVERY_RULES = [
  { key: "PROJECT_CREATED", category: "项目交付", label: "新建项目", description: "项目创建后通知所选项目负责人和客户成员", emailSupported: true, emailDefaultEnabled: false, dingtalkSupported: false },
  { key: "PROJECT_UPDATE", category: "项目交付", label: "进度动态与评论", description: "面向客户发布的项目动态和评论", emailSupported: true, emailDefaultEnabled: false, dingtalkSupported: false },
  { key: "PROJECT_STAGE", category: "项目交付", label: "项目阶段变化", description: "项目当前阶段发生变化", emailSupported: true, emailDefaultEnabled: false, dingtalkSupported: false },
  { key: "PROJECT_MILESTONE", category: "项目交付", label: "里程碑变化", description: "里程碑新增、修改或删除", emailSupported: true, emailDefaultEnabled: false, dingtalkSupported: false },
  { key: "PROJECT_FILE", category: "项目交付", label: "项目文件上传", description: "非编辑器内嵌的公开项目文件", emailSupported: true, emailDefaultEnabled: false, dingtalkSupported: false },
  { key: "REQUEST_CREATED", category: "服务请求", label: "新建服务请求", description: "客户、外部联系人或后台人员创建新的服务请求", emailSupported: true, emailDefaultEnabled: true, dingtalkSupported: true },
  { key: "REQUEST_ASSIGNED", category: "服务请求", label: "处理人分配", description: "处理人或协作人员发生变化", emailSupported: true, emailDefaultEnabled: true, dingtalkSupported: false },
  { key: "REQUEST_CLAIMED", category: "服务请求", label: "服务请求已接手", description: "项目人员首次公开回复并自动接手时通知平台管理员", emailSupported: true, emailDefaultEnabled: true, dingtalkSupported: false },
  { key: "REQUEST_PUBLIC_MESSAGE", category: "服务请求", label: "公开回复", description: "邮件双向提醒；钉钉仅提醒客户或外部联系人的回复", emailSupported: true, emailDefaultEnabled: true, dingtalkSupported: true },
  { key: "REQUEST_INTERNAL_NOTE", category: "服务请求", label: "内部备注", description: "仅后台人员可见的服务请求备注", emailSupported: false, emailDefaultEnabled: false, dingtalkSupported: false },
  { key: "REQUEST_STATUS", category: "服务请求", label: "手动状态变化", description: "等待客户、已解决或已关闭等手动状态", emailSupported: true, emailDefaultEnabled: true, dingtalkSupported: false },
  { key: "REQUEST_ATTACHMENT", category: "服务请求", label: "独立附件上传", description: "脱离消息单独上传的公开附件", emailSupported: false, emailDefaultEnabled: false, dingtalkSupported: false },
  { key: "REQUEST_ARCHIVE", category: "服务请求", label: "归档与恢复", description: "后台归档或恢复服务请求", emailSupported: false, emailDefaultEnabled: false, dingtalkSupported: false },
  { key: "CONTENT_RISK_ALERT", category: "内容风控", label: "联系方式与站外交易告警", description: "明确规则阻止、AI撤回、人工确认和插件异常旁路告警", emailSupported: true, emailDefaultEnabled: true, dingtalkSupported: true, dingtalkDefaultEnabled: true },
] as const;

export type NotificationDeliveryRuleKey =
  (typeof NOTIFICATION_DELIVERY_RULES)[number]["key"];

export type NotificationDeliveryRuleState = {
  notificationEnabled: boolean;
  soundEnabled: boolean;
  emailEnabled: boolean;
  dingtalkEnabled: boolean;
};

export type NotificationDeliveryRuleView =
  (typeof NOTIFICATION_DELIVERY_RULES)[number] & NotificationDeliveryRuleState;

export const STANDARD_REQUEST_EMAIL_RULE_KEYS = [
  "REQUEST_CREATED",
  "REQUEST_ASSIGNED",
  "REQUEST_CLAIMED",
  "REQUEST_PUBLIC_MESSAGE",
  "REQUEST_STATUS",
] as const satisfies readonly NotificationDeliveryRuleKey[];

export const STANDARD_PROJECT_EMAIL_RULE_KEYS = [
  "PROJECT_CREATED",
  "PROJECT_UPDATE",
  "PROJECT_STAGE",
  "PROJECT_MILESTONE",
  "PROJECT_FILE",
] as const satisfies readonly NotificationDeliveryRuleKey[];

export const STANDARD_NOTIFICATION_EMAIL_RULE_KEYS = [
  ...STANDARD_PROJECT_EMAIL_RULE_KEYS,
  ...STANDARD_REQUEST_EMAIL_RULE_KEYS,
  "CONTENT_RISK_ALERT",
] as const satisfies readonly NotificationDeliveryRuleKey[];

export const notificationDeliveryRuleKeySchema = z.enum(
  NOTIFICATION_DELIVERY_RULES.map((rule) => rule.key) as [
    NotificationDeliveryRuleKey,
    ...NotificationDeliveryRuleKey[],
  ],
);

export const updateNotificationDeliveryRulesSchema = z.object({
  rules: z
    .array(
      z.object({
        key: notificationDeliveryRuleKeySchema,
        notificationEnabled: z.boolean(),
        soundEnabled: z.boolean(),
        emailEnabled: z.boolean(),
        dingtalkEnabled: z.boolean(),
      }),
    )
    .min(1)
    .max(NOTIFICATION_DELIVERY_RULES.length),
});

export type NotificationDeliveryRuleUpdate = z.infer<
  typeof updateNotificationDeliveryRulesSchema
>["rules"][number];

export function findNotificationDeliveryRuleViolation(
  rules: NotificationDeliveryRuleUpdate[],
) {
  const definitionByKey = new Map(
    NOTIFICATION_DELIVERY_RULES.map((rule) => [rule.key, rule]),
  );
  const seen = new Set<NotificationDeliveryRuleKey>();
  for (const rule of rules) {
    if (seen.has(rule.key)) {
      return {
        code: "DUPLICATE_NOTIFICATION_RULE",
        message: "通知场景不能重复",
      } as const;
    }
    seen.add(rule.key);

    if (rule.key === "CONTENT_RISK_ALERT" && !rule.notificationEnabled) {
      return {
        code: "CONTENT_RISK_NOTIFICATION_REQUIRED",
        message: "风控站内告警必须保持开启",
      } as const;
    }

    if (!definitionByKey.get(rule.key)?.emailSupported && rule.emailEnabled) {
      return {
        code: "EMAIL_NOT_SUPPORTED",
        message: "该场景不支持邮件提醒",
      } as const;
    }
    if (rule.emailEnabled && !rule.notificationEnabled) {
      return {
        code: "EMAIL_REQUIRES_NOTIFICATION",
        message: "邮件提醒依赖通知未读状态，请先开启通知红点",
      } as const;
    }
    if (
      !definitionByKey.get(rule.key)?.dingtalkSupported &&
      rule.dingtalkEnabled
    ) {
      return {
        code: "DINGTALK_NOT_SUPPORTED",
        message: "该场景不支持钉钉机器人提醒",
      } as const;
    }
  }
  return null;
}

export function resolveNotificationSoundEnabled(
  ruleSoundEnabled: boolean,
  activityAudible?: boolean,
) {
  return ruleSoundEnabled && activityAudible !== false;
}

export function defaultNotificationDeliveryRuleState(
  key: NotificationDeliveryRuleKey,
): NotificationDeliveryRuleState {
  const definition = NOTIFICATION_DELIVERY_RULES.find(
    (candidate) => candidate.key === key,
  );
  return {
    notificationEnabled: true,
    soundEnabled: true,
    emailEnabled: definition?.emailDefaultEnabled ?? false,
    dingtalkEnabled:
      definition && "dingtalkDefaultEnabled" in definition
        ? definition.dingtalkDefaultEnabled
        : false,
  };
}

export function ruleKeyForNotificationEmail(type: string) {
  if (type === "PROJECT_CREATED") return "PROJECT_CREATED" as const;
  if (type === "PROJECT_UPDATE" || type === "UPDATE_COMMENT") {
    return "PROJECT_UPDATE" as const;
  }
  if (type === "PROJECT_STAGE") return "PROJECT_STAGE" as const;
  if (type === "PROJECT_MILESTONE") return "PROJECT_MILESTONE" as const;
  if (type === "PROJECT_FILE") return "PROJECT_FILE" as const;
  if (type === "REQUEST_CREATED") return "REQUEST_CREATED" as const;
  if (type === "REQUEST_ASSIGNED") return "REQUEST_ASSIGNED" as const;
  if (type === "REQUEST_CLAIMED") return "REQUEST_CLAIMED" as const;
  if (type === "REQUEST_MESSAGE") return "REQUEST_PUBLIC_MESSAGE" as const;
  if (type === "REQUEST_STATUS") return "REQUEST_STATUS" as const;
  if (type === "CONTENT_RISK") return "CONTENT_RISK_ALERT" as const;
  return null;
}

export function notificationTypesForEmailRule(
  key: NotificationDeliveryRuleKey,
) {
  if (key === "PROJECT_CREATED") return ["PROJECT_CREATED"] as const;
  if (key === "PROJECT_UPDATE") {
    return ["PROJECT_UPDATE", "UPDATE_COMMENT"] as const;
  }
  if (key === "PROJECT_STAGE") return ["PROJECT_STAGE"] as const;
  if (key === "PROJECT_MILESTONE") return ["PROJECT_MILESTONE"] as const;
  if (key === "PROJECT_FILE") return ["PROJECT_FILE"] as const;
  if (key === "REQUEST_CREATED") return ["REQUEST_CREATED"] as const;
  if (key === "REQUEST_ASSIGNED") return ["REQUEST_ASSIGNED"] as const;
  if (key === "REQUEST_CLAIMED") return ["REQUEST_CLAIMED"] as const;
  if (key === "REQUEST_PUBLIC_MESSAGE") return ["REQUEST_MESSAGE"] as const;
  if (key === "REQUEST_STATUS") return ["REQUEST_STATUS"] as const;
  if (key === "CONTENT_RISK_ALERT") return ["CONTENT_RISK"] as const;
  return [] as const;
}

export function dingTalkEventTypesForRule(
  key: NotificationDeliveryRuleKey,
) {
  if (key === "REQUEST_CREATED") return ["REQUEST_CREATED"] as const;
  if (key === "REQUEST_PUBLIC_MESSAGE") {
    return ["REQUEST_CUSTOMER_REPLIED"] as const;
  }
  if (key === "CONTENT_RISK_ALERT") return ["CONTENT_RISK_ALERT"] as const;
  return [] as const;
}

export function isNotificationEmailRuleEnabled(
  notificationType: string,
  stateByKey: ReadonlyMap<string, NotificationDeliveryRuleState>,
) {
  const key = ruleKeyForNotificationEmail(notificationType);
  if (!key) return false;
  const state = stateByKey.get(key) ?? defaultNotificationDeliveryRuleState(key);
  return state.notificationEnabled && state.emailEnabled;
}

export function ruleKeyForProjectNotification(type: string) {
  if (type === "PROJECT_CREATED") return "PROJECT_CREATED" as const;
  if (type === "PROJECT_STAGE") return "PROJECT_STAGE" as const;
  if (type === "PROJECT_MILESTONE") return "PROJECT_MILESTONE" as const;
  if (type === "PROJECT_FILE") return "PROJECT_FILE" as const;
  return "PROJECT_UPDATE" as const;
}

export function ruleKeyForRequestActivity(input: {
  notificationType: string;
  visibility?: string;
}) {
  if (input.notificationType === "REQUEST_CREATED") {
    return "REQUEST_CREATED" as const;
  }
  if (input.notificationType === "REQUEST_ASSIGNED") {
    return "REQUEST_ASSIGNED" as const;
  }
  if (input.notificationType === "REQUEST_CLAIMED") {
    return "REQUEST_CLAIMED" as const;
  }
  if (input.notificationType === "REQUEST_STATUS") {
    return "REQUEST_STATUS" as const;
  }
  if (input.notificationType === "REQUEST_ATTACHMENT") {
    return "REQUEST_ATTACHMENT" as const;
  }
  if (input.notificationType === "REQUEST_ARCHIVE") {
    return "REQUEST_ARCHIVE" as const;
  }
  return input.visibility === "INTERNAL"
    ? ("REQUEST_INTERNAL_NOTE" as const)
    : ("REQUEST_PUBLIC_MESSAGE" as const);
}
