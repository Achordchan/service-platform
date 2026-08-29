import type { NotificationDeliveryOverride } from "@/modules/notifications/notification-delivery-override";

/** 提示行/弹窗要预览的场景，与 /api/v1/notifications/delivery-preview 的入参一致 */
export type DeliveryScene =
  | { scene: "PROJECT_UPDATE"; projectId: string; visibility: "CUSTOMER_VISIBLE" | "INTERNAL" }
  | { scene: "PROJECT_MILESTONE"; projectId: string }
  | { scene: "PROJECT_STAFF"; projectId: string; targetUserId: string }
  | { scene: "REQUEST_PUBLIC_MESSAGE"; requestId: string }
  | {
      scene: "REQUEST_STATUS";
      requestId: string;
      status: "PENDING" | "IN_PROGRESS" | "WAITING_CUSTOMER" | "RESOLVED" | "CLOSED";
    };

/** 场景 → 后台通知规则 key（提示行据此读当前开着哪些通道，无需查收件人） */
export const RULE_KEY_BY_SCENE: Record<DeliveryScene["scene"], string> = {
  PROJECT_UPDATE: "PROJECT_UPDATE",
  PROJECT_MILESTONE: "PROJECT_MILESTONE",
  PROJECT_STAFF: "PROJECT_STAFF",
  REQUEST_PUBLIC_MESSAGE: "REQUEST_PUBLIC_MESSAGE",
  REQUEST_STATUS: "REQUEST_STATUS",
};

export type DeliveryChannelRule = {
  key: string;
  label: string;
  notificationEnabled: boolean;
  emailEnabled: boolean;
  wechatEnabled: boolean;
  emailSupported: boolean;
  wechatSupported: boolean;
};

export type DeliveryChannelKey = "notification" | "email" | "wechat";

export const DELIVERY_CHANNEL_LABELS: Record<DeliveryChannelKey, string> = {
  notification: "站内通知",
  email: "邮件",
  wechat: "微信订阅",
};

/**
 * 提示行文案：本次会走哪些通道。
 *
 * 站内是载体 —— 它关掉，邮件与微信一并失效，所以要先判它。
 */
export function deliveryNoticeChannels(
  rule: DeliveryChannelRule | null,
  override: NotificationDeliveryOverride,
): DeliveryChannelKey[] {
  if (!rule) return [];
  const notification = override.notification ?? rule.notificationEnabled;
  if (!notification) return [];
  const channels: DeliveryChannelKey[] = ["notification"];
  if (rule.emailSupported && (override.email ?? rule.emailEnabled)) {
    channels.push("email");
  }
  if (rule.wechatSupported && (override.wechat ?? rule.wechatEnabled)) {
    channels.push("wechat");
  }
  return channels;
}

export function deliveryNoticeText(channels: DeliveryChannelKey[]) {
  if (channels.length === 0) return "本次操作不会发出提醒";
  return `即将通过 ${channels
    .map((channel) => DELIVERY_CHANNEL_LABELS[channel])
    .join(" · ")} 提醒相关人员`;
}

/**
 * 是否已显式自定义本次送达。
 *
 * 判据是「有没有显式设过值」，不是「值与后台规则是否不同」：规则本来就开着邮件、
 * 而某收件人自己退订了时，开关停在默认的「开」上同样意味着强制发送（弹窗里逐人
 * 标的就是「强制发送」）。若按「与规则相同就不算覆盖」丢掉它，后端 isEmailForced
 * 看不到显式的 true，实际仍会尊重退订 —— UI 承诺与真实行为就对不上了。
 *
 * 与服务端 hasDeliveryOverride 同口径。
 */
export function isDeliveryOverrideActive(
  override: NotificationDeliveryOverride,
  rule: DeliveryChannelRule | null,
) {
  if (!rule) return false;
  return (
    override.notification !== undefined ||
    override.email !== undefined ||
    override.wechat !== undefined ||
    (override.excludeUserIds?.length ?? 0) > 0
  );
}

/**
 * 把弹窗里的选择固化成显式值再提交。
 *
 * 不能只提交「与后台规则不同」的那几项：规则本来就开着邮件、而收件人自己退订了时，
 * 开关停在默认的「开」上同样意味着强制发送 —— 弹窗逐人标的是「强制发送」、警告条
 * 写的也是「保持开启将强制发送」。把它归一成 undefined，后端 isEmailForced 看不到
 * 显式的 true，实际仍会尊重退订，UI 承诺与真实行为就对不上。
 *
 * 不支持的通道不写，交给服务端 sanitizeDeliveryOverride 再挡一次。
 */
export function materializeDeliveryOverride(
  draft: NotificationDeliveryOverride,
  rule: {
    notificationEnabled: boolean;
    emailEnabled: boolean;
    wechatEnabled: boolean;
    emailSupported: boolean;
    wechatSupported: boolean;
  },
): NotificationDeliveryOverride {
  return {
    notification: draft.notification ?? rule.notificationEnabled,
    ...(rule.emailSupported
      ? { email: draft.email ?? rule.emailEnabled }
      : {}),
    ...(rule.wechatSupported
      ? { wechat: draft.wechat ?? rule.wechatEnabled }
      : {}),
    ...(draft.excludeUserIds?.length
      ? { excludeUserIds: draft.excludeUserIds }
      : {}),
  };
}

/** 传给写接口的 body 片段：没有任何覆盖时不带这个字段 */
export function deliveryOverridePayload(
  override: NotificationDeliveryOverride,
  rule: DeliveryChannelRule | null,
) {
  return isDeliveryOverrideActive(override, rule)
    ? { deliveryOverride: override }
    : {};
}
