import { z } from "zod";

/**
 * 单次操作的投递覆盖。
 *
 * 优先级：**本次操作的显式选择 > 收件人个人偏好 > 后台通知规则**。
 * 字段为 undefined 表示「不干预，按原有规则与偏好走」，只有显式 true / false
 * 才会覆盖。这是整套通知体系里唯一可以凌驾于收件人偏好之上的入口，因此：
 *
 * - 只有员工侧的写操作可以传；
 * - 真正改变了投递结果时必须落审计（NOTIFICATION_DELIVERY_OVERRIDDEN）。
 *
 * 三个渠道不是并列关系：站内通知是载体，邮件与微信订阅都挂在通知记录上，
 * 站内一关，另外两个自动失效。
 */
export const notificationDeliveryOverrideSchema = z.object({
  /** 站内通知（红点 + 消息列表）。关闭后邮件与微信订阅一并失效。 */
  notification: z.boolean().optional(),
  /** 邮件。为 true 时无视收件人的全局开关与按场景退订。 */
  email: z.boolean().optional(),
  /** 微信订阅消息。为 true 也只能覆盖后台规则，覆盖不了未绑定与额度耗尽。 */
  wechat: z.boolean().optional(),
  /**
   * 本次不提醒这些人。
   *
   * 与「强制发送」刻意不对称：强制只能在渠道级做（一个决定、对所有人负责），
   * 排除可以逐人做 —— 少发不越权，不会替谁决定他该收到自己关掉的东西。
   * 排除掉的人连站内通知都不生成，邮件与微信自然一并没有。
   */
  excludeUserIds: z.array(z.string().min(1)).max(200).optional(),
});

export type NotificationDeliveryOverride = z.infer<
  typeof notificationDeliveryOverrideSchema
>;

export function hasDeliveryOverride(
  override?: NotificationDeliveryOverride | null,
): override is NotificationDeliveryOverride {
  if (!override) return false;
  return (
    override.notification !== undefined ||
    override.email !== undefined ||
    override.wechat !== undefined ||
    (override.excludeUserIds?.length ?? 0) > 0
  );
}

/** 覆盖优先，没给就用规则值 */
export function resolveDeliveryChannel(
  ruleEnabled: boolean,
  overrideValue?: boolean,
) {
  return overrideValue ?? ruleEnabled;
}

/** 邮件被强制打开：此时才允许无视收件人的退订偏好 */
export function isEmailForced(override?: NotificationDeliveryOverride | null) {
  return override?.email === true;
}

export type DeliveryOverrideEffect = {
  /** 后台规则本来关着、被本次操作强制打开的渠道 */
  forcedChannels: Array<"notification" | "email" | "wechat">;
  /** 后台规则本来开着、被本次操作关掉的渠道 */
  suppressedChannels: Array<"notification" | "email" | "wechat">;
  /** 个人已退订邮件、但本次被强制送达的收件人 */
  emailPreferenceOverriddenUserIds: string[];
  /** 本来会收到、被本次操作逐人排除掉的收件人 */
  excludedUserIds: string[];
};

export function isDeliveryOverrideEffective(effect: DeliveryOverrideEffect) {
  return (
    effect.forcedChannels.length > 0 ||
    effect.suppressedChannels.length > 0 ||
    effect.emailPreferenceOverriddenUserIds.length > 0 ||
    effect.excludedUserIds.length > 0
  );
}

export function describeDeliveryChannel(
  channel: "notification" | "email" | "wechat",
) {
  if (channel === "notification") return "站内通知";
  if (channel === "email") return "邮件";
  return "微信订阅";
}

/**
 * 丢掉「本场景根本不支持的通道」上的覆盖。
 *
 * 后台规则那侧有 findNotificationDeliveryRuleViolation 拦着，管理员开不了不支持
 * 的通道；覆盖是另一条入口，必须自己挡一次，否则伪造请求就能给「内部备注」这类
 * 场景强开邮件。
 */
export function sanitizeDeliveryOverride(
  override: NotificationDeliveryOverride | undefined,
  support: { emailSupported: boolean; wechatSupported: boolean },
): NotificationDeliveryOverride | undefined {
  if (!override) return undefined;
  const sanitized: NotificationDeliveryOverride = {
    notification: override.notification,
    ...(support.emailSupported ? { email: override.email } : {}),
    ...(support.wechatSupported ? { wechat: override.wechat } : {}),
    ...(override.excludeUserIds?.length
      ? { excludeUserIds: [...new Set(override.excludeUserIds)] }
      : {}),
  };
  return hasDeliveryOverride(sanitized) ? sanitized : undefined;
}

/** 场景定义里的通道支持情况 */
export function deliveryChannelSupport(definition: {
  emailSupported: boolean;
  wechatSupported: boolean;
}) {
  return {
    emailSupported: definition.emailSupported,
    wechatSupported: definition.wechatSupported,
  };
}

/**
 * 应用逐人排除，返回真正被排掉的人（用于审计）。
 *
 * 只过滤通知，不过滤实时事件 —— 事件负责页面刷新，排除某人不该让他看到过期内容。
 * 但事件会带上静音名单（见 persistActivityDelivery），被排除的人不会听到提示音。
 */
export function applyDeliveryExclusions<T extends { userId: string }>(
  notifications: T[],
  override?: NotificationDeliveryOverride,
) {
  const excludeUserIds = override?.excludeUserIds;
  if (!excludeUserIds?.length) {
    return { notifications, excludedUserIds: [] as string[] };
  }
  const excluded = new Set(excludeUserIds);
  const kept = notifications.filter((item) => !excluded.has(item.userId));
  return {
    notifications: kept,
    excludedUserIds: notifications
      .filter((item) => excluded.has(item.userId))
      .map((item) => item.userId),
  };
}
