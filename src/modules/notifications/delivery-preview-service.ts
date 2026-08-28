import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import {
  NOTIFICATION_DELIVERY_RULES,
  type NotificationDeliveryRuleKey,
} from "@/modules/notifications/notification-delivery-rules";
import { loadNotificationDeliveryRule } from "@/modules/notifications/notification-delivery-rule-service";
import {
  WECHAT_SUBSCRIBE_TEMPLATES,
  type WechatTemplateKey,
} from "@/modules/miniapp/wechat-subscribe-message-service";

/**
 * 已知边界：预览只列平台用户。外部联系人（Sub2API 等外部门户创建的工单）的邮件
 * 不挂在 Notification 行上、由命令层单独入队，也没有 userId，逐人排除
 * （excludeUserIds）对他们无从谈起，因此不进这个列表。
 *
 * 行为上他们仍受本次覆盖的「邮件」开关约束（见 request-command-service 里
 * emailChannelEnabled 的用法）—— 关掉邮件他们同样不会收到。缺的只是「预览里
 * 看不到他们」这条信息，要补齐需要给预览引入非用户收件人这一类，属于后续工作。
 */

/** 收件人在邮件通道上的状态 */
export type EmailRecipientState =
  /** 会收到 */
  | "READY"
  /** 本人关掉了（全局开关或按场景退订）→ 置灰，但允许强制 */
  | "USER_OFF"
  /** 本场景本来就不给此人发邮件（如后台同事之间的回复只邮件通知客户） */
  | "NOT_TARGETED";

/** 收件人在微信订阅通道上的状态 */
export type WechatRecipientState =
  | "READY"
  /** 没绑小程序 —— 硬约束，强制也送不出去 */
  | "NO_BINDING"
  /** 订阅额度已用尽 —— 硬约束，强制也送不出去 */
  | "NO_QUOTA"
  /** 本场景没有对应的订阅模板 */
  | "UNSUPPORTED";

export type DeliveryPreviewRecipient = {
  userId: string;
  name: string;
  isCustomer: boolean;
  emailState: EmailRecipientState;
  wechatState: WechatRecipientState;
};

export type DeliveryPreview = {
  ruleKey: NotificationDeliveryRuleKey;
  label: string;
  rule: {
    notificationEnabled: boolean;
    emailEnabled: boolean;
    wechatEnabled: boolean;
    emailSupported: boolean;
    wechatSupported: boolean;
  };
  /** 邮件当前是本地收件箱模式：勾了也不会真正外发，UI 要提示 */
  mailLocalOutbox: boolean;
  recipients: DeliveryPreviewRecipient[];
  summary: {
    total: number;
    emailReady: number;
    emailUserOff: number;
    wechatReady: number;
    wechatUnavailable: number;
  };
};

function ruleDefinition(key: NotificationDeliveryRuleKey) {
  const definition = NOTIFICATION_DELIVERY_RULES.find(
    (item) => item.key === key,
  );
  if (!definition) throw new Error(`未知通知场景：${key}`);
  return definition;
}

function wechatTemplateForRule(
  key: NotificationDeliveryRuleKey,
): WechatTemplateKey | null {
  return (
    WECHAT_SUBSCRIBE_TEMPLATES.find((template) => template.ruleKey === key)
      ?.templateKey ?? null
  );
}

/**
 * 把「收件人名单」翻译成「每个人在每条通道上的真实状态」。
 *
 * 名单本身由各领域服务算好后传进来（与真正发送时走同一套函数），这里只负责
 * 通道侧的解析，避免收件人规则出现两份实现而漂移。
 */
export async function resolveDeliveryPreview(
  tx: Prisma.TransactionClient,
  input: {
    ruleKey: NotificationDeliveryRuleKey;
    /** 会收到站内通知的人 */
    notificationUserIds: string[];
    /** 其中本场景会发邮件的人（按规则算，未考虑个人偏好） */
    emailUserIds: string[];
  },
): Promise<DeliveryPreview> {
  const definition = ruleDefinition(input.ruleKey);
  const rule = await loadNotificationDeliveryRule(tx, input.ruleKey);
  const userIds = [...new Set(input.notificationUserIds)];
  const emailTargets = new Set(
    input.emailUserIds.filter((userId) => userIds.includes(userId)),
  );

  if (userIds.length === 0) {
    return {
      ruleKey: input.ruleKey,
      label: definition.label,
      rule: {
        notificationEnabled: rule.notificationEnabled,
        emailEnabled: rule.emailEnabled,
        wechatEnabled: rule.wechatEnabled,
        emailSupported: definition.emailSupported,
        wechatSupported: definition.wechatSupported,
      },
      mailLocalOutbox: await isMailLocalOutbox(tx),
      recipients: [],
      summary: {
        total: 0,
        emailReady: 0,
        emailUserOff: 0,
        wechatReady: 0,
        wechatUnavailable: 0,
      },
    };
  }

  const users = await tx.user.findMany({
    where: { id: { in: userIds } },
    select: {
      id: true,
      name: true,
      platformRole: true,
      requestEmailNotificationsEnabled: true,
    },
  });
  // 按场景退订存在 UserNotificationPreference（有 RLS，普通发送方读不到他人行），
  // 必须走 SECURITY DEFINER 函数，直接 findMany 会恒为空 → 把已退订的人误判成会收到
  const optouts = await tx.$queryRaw<Array<{ user_id: string; rule_key: string }>>`
    SELECT user_id, rule_key
    FROM app_notification_email_optouts(${userIds}::text[])
  `;
  const optedOut = new Set(
    optouts
      .filter((row) => row.rule_key === input.ruleKey)
      .map((row) => row.user_id),
  );

  const templateKey = wechatTemplateForRule(input.ruleKey);
  const bindings = templateKey
    ? await tx.wechatBinding.findMany({
        where: { userId: { in: userIds } },
        select: { userId: true },
      })
    : [];
  const boundUserIds = new Set(bindings.map((item) => item.userId));
  const grants = templateKey
    ? await tx.wechatSubscribeGrant.findMany({
        where: { userId: { in: userIds }, templateKey },
        select: { userId: true, remaining: true },
      })
    : [];
  const remainingByUserId = new Map(
    grants.map((grant) => [grant.userId, grant.remaining]),
  );

  const recipients: DeliveryPreviewRecipient[] = users.map((user) => {
    const emailState: EmailRecipientState = !emailTargets.has(user.id)
      ? "NOT_TARGETED"
      : !user.requestEmailNotificationsEnabled || optedOut.has(user.id)
        ? "USER_OFF"
        : "READY";
    const wechatState: WechatRecipientState = !templateKey
      ? "UNSUPPORTED"
      : !boundUserIds.has(user.id)
        ? "NO_BINDING"
        : (remainingByUserId.get(user.id) ?? 0) <= 0
          ? "NO_QUOTA"
          : "READY";
    return {
      userId: user.id,
      name: user.name,
      isCustomer: user.platformRole === "CUSTOMER",
      emailState,
      wechatState,
    };
  });
  recipients.sort((a, b) => a.name.localeCompare(b.name, "zh-Hans-CN"));

  return {
    ruleKey: input.ruleKey,
    label: definition.label,
    rule: {
      notificationEnabled: rule.notificationEnabled,
      emailEnabled: rule.emailEnabled,
      wechatEnabled: rule.wechatEnabled,
      emailSupported: definition.emailSupported,
      wechatSupported: definition.wechatSupported,
    },
    mailLocalOutbox: await isMailLocalOutbox(tx),
    recipients,
    summary: {
      total: recipients.length,
      emailReady: recipients.filter((item) => item.emailState === "READY")
        .length,
      emailUserOff: recipients.filter((item) => item.emailState === "USER_OFF")
        .length,
      wechatReady: recipients.filter((item) => item.wechatState === "READY")
        .length,
      wechatUnavailable: recipients.filter(
        (item) =>
          item.wechatState === "NO_BINDING" || item.wechatState === "NO_QUOTA",
      ).length,
    },
  };
}

async function isMailLocalOutbox(tx: Prisma.TransactionClient) {
  const [settings] = await tx.$queryRaw<
    Array<{ mail_mode: "LOCAL_OUTBOX" | "RESEND" | "SMTP" }>
  >`SELECT mail_mode FROM app_notification_mail_runtime_settings()`;
  return settings?.mail_mode === "LOCAL_OUTBOX";
}
