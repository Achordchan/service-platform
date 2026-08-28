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

/**
 * 是否已显式自定义本次送达。与 Web 端 src/lib/delivery-notice.ts 同口径。
 *
 * 判据是「有没有显式设过值」，不是「值与后台规则是否不同」：规则本来就开着邮件、
 * 而某收件人自己退订了时，开关停在默认的「开」上同样意味着强制发送。若按「与规则
 * 相同就不算覆盖」丢掉它，后端 isEmailForced 看不到显式的 true，实际仍会尊重退订。
 */
export function isDeliveryOverrideActive(
  override: DeliveryOverride,
  rule: DeliveryChannelRule | null,
) {
  if (!rule) return false;
  return (
    override.notification !== undefined ||
    override.email !== undefined ||
    override.wechat !== undefined ||
    (override.excludeUserIds ? override.excludeUserIds.length > 0 : false)
  );
}

/**
 * 把弹窗里的选择固化成显式值再提交（与 Web 端 materializeOverride 同口径）。
 * 不支持的通道不写，交给服务端 sanitizeDeliveryOverride 再挡一次。
 */
export function materializeDeliveryOverride(
  draft: DeliveryOverride,
  rule: {
    notificationEnabled: boolean;
    emailEnabled: boolean;
    wechatEnabled: boolean;
    emailSupported: boolean;
    wechatSupported: boolean;
  },
): DeliveryOverride {
  const next: DeliveryOverride = {
    notification: draft.notification ?? rule.notificationEnabled,
  };
  if (rule.emailSupported) next.email = draft.email ?? rule.emailEnabled;
  if (rule.wechatSupported) next.wechat = draft.wechat ?? rule.wechatEnabled;
  if (draft.excludeUserIds && draft.excludeUserIds.length > 0) {
    next.excludeUserIds = draft.excludeUserIds;
  }
  return next;
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
