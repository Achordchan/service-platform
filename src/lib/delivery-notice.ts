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

export function isDeliveryOverrideActive(
  override: NotificationDeliveryOverride,
  rule: DeliveryChannelRule | null,
) {
  if (!rule) return false;
  return (
    (override.notification !== undefined &&
      override.notification !== rule.notificationEnabled) ||
    (override.email !== undefined && override.email !== rule.emailEnabled) ||
    (override.wechat !== undefined && override.wechat !== rule.wechatEnabled) ||
    (override.excludeUserIds?.length ?? 0) > 0
  );
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
