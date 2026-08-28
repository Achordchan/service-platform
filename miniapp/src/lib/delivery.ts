import {
  listDeliveryChannels,
  type DeliveryChannelRule,
  type DeliveryOverride,
  type DeliveryScene,
} from "./api";

export type { DeliveryChannelRule, DeliveryOverride, DeliveryScene };

export type DeliveryChannelKey = "notification" | "email" | "wechat";

export const DELIVERY_CHANNEL_LABELS: Record<DeliveryChannelKey, string> = {
  notification: "站内通知",
  email: "邮件",
  wechat: "微信订阅",
};

export const RULE_KEY_BY_SCENE: Record<DeliveryScene["scene"], string> = {
  PROJECT_UPDATE: "PROJECT_UPDATE",
  PROJECT_MILESTONE: "PROJECT_MILESTONE",
  PROJECT_STAFF: "PROJECT_STAFF",
  REQUEST_PUBLIC_MESSAGE: "REQUEST_PUBLIC_MESSAGE",
  REQUEST_STATUS: "REQUEST_STATUS",
};

// 全场景共用一份：只是「哪些通道当前开着」，与收件人无关，一次会话拉一次
let cache: DeliveryChannelRule[] | null = null;
let inflight: Promise<DeliveryChannelRule[]> | null = null;

export function fetchDeliveryChannels(): Promise<DeliveryChannelRule[]> {
  if (cache) return Promise.resolve(cache);
  inflight ??= listDeliveryChannels()
    .then((rules) => {
      // 提示行是辅助信息：拿到非预期载荷就当没有规则，别把宿主页面打崩
      cache = Array.isArray(rules) ? rules : [];
      return cache;
    })
    .catch(() => {
      cache = [];
      return cache;
    })
    .then((rules) => {
      inflight = null;
      return rules;
    });
  return inflight;
}

export function clearDeliveryChannelsCache() {
  cache = null;
}

export async function fetchDeliveryRule(scene: DeliveryScene["scene"]) {
  const rules = await fetchDeliveryChannels();
  return rules.find((rule) => rule.key === RULE_KEY_BY_SCENE[scene]) ?? null;
}

/**
 * 提示行文案：本次会走哪些通道。
 * 站内是载体 —— 它关掉，邮件与微信一并失效，所以要先判它。
 */
export function deliveryNoticeChannels(
  rule: DeliveryChannelRule | null,
  override: DeliveryOverride,
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
  override: DeliveryOverride,
  rule: DeliveryChannelRule | null,
) {
  if (!rule) return false;
  return (
    (override.notification !== undefined &&
      override.notification !== rule.notificationEnabled) ||
    (override.email !== undefined && override.email !== rule.emailEnabled) ||
    (override.wechat !== undefined && override.wechat !== rule.wechatEnabled) ||
    (override.excludeUserIds ? override.excludeUserIds.length > 0 : false)
  );
}

/** 传给写接口的 body 片段：没有任何覆盖时不带这个字段 */
export function deliveryOverridePayload(
  override: DeliveryOverride,
  rule: DeliveryChannelRule | null,
): { deliveryOverride?: DeliveryOverride } {
  return isDeliveryOverrideActive(override, rule)
    ? { deliveryOverride: override }
    : {};
}

export const EMAIL_STATE_LABELS: Record<string, string> = {
  READY: "会收到",
  USER_OFF: "本人已关闭",
  NOT_TARGETED: "本场景不发邮件",
};

export const WECHAT_STATE_LABELS: Record<string, string> = {
  READY: "会收到",
  NO_BINDING: "未绑定小程序",
  NO_QUOTA: "额度已用尽",
  UNSUPPORTED: "无订阅模板",
};
