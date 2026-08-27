import "server-only";

import type { Prisma, NotificationType } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { env } from "@/lib/runtime-env";
import {
  clipWechatPhrase,
  clipWechatThing,
} from "@/modules/miniapp/wechat-api-client";
import {
  defaultNotificationDeliveryRuleState,
  type NotificationDeliveryRuleKey,
} from "@/modules/notifications/notification-delivery-rules";

export type WechatTemplateKey =
  | "REQUEST_REPLY"
  | "REQUEST_STATUS"
  | "PROJECT_UPDATE";

type TemplateDefinition = {
  templateKey: WechatTemplateKey;
  ruleKey: NotificationDeliveryRuleKey;
  notificationTypes: readonly NotificationType[];
  templateIdEnv?:
    | "WECHAT_TEMPLATE_REQUEST_REPLY_ID"
    | "WECHAT_TEMPLATE_REQUEST_STATUS_ID"
    | "WECHAT_TEMPLATE_PROJECT_UPDATE_ID";
};

export const WECHAT_SUBSCRIBE_TEMPLATES: readonly TemplateDefinition[] = [
  {
    templateKey: "REQUEST_REPLY",
    ruleKey: "REQUEST_PUBLIC_MESSAGE",
    notificationTypes: ["REQUEST_MESSAGE"],
    templateIdEnv: "WECHAT_TEMPLATE_REQUEST_REPLY_ID",
  },
  {
    templateKey: "REQUEST_STATUS",
    ruleKey: "REQUEST_STATUS",
    notificationTypes: ["REQUEST_STATUS"],
    templateIdEnv: "WECHAT_TEMPLATE_REQUEST_STATUS_ID",
  },
  {
    templateKey: "PROJECT_UPDATE",
    ruleKey: "PROJECT_UPDATE",
    notificationTypes: ["PROJECT_UPDATE"],
    templateIdEnv: "WECHAT_TEMPLATE_PROJECT_UPDATE_ID",
  },
] as const;

export function templateKeyForNotificationType(
  type: NotificationType,
): WechatTemplateKey | null {
  const definition = WECHAT_SUBSCRIBE_TEMPLATES.find((template) =>
    template.notificationTypes.includes(type),
  );
  return definition?.templateKey ?? null;
}

export function templateIdFor(templateKey: WechatTemplateKey): string | null {
  const definition = WECHAT_SUBSCRIBE_TEMPLATES.find(
    (template) => template.templateKey === templateKey,
  );
  if (!definition?.templateIdEnv) return null;
  return env[definition.templateIdEnv] ?? null;
}

export function isWechatTemplateKey(value: string): value is WechatTemplateKey {
  return WECHAT_SUBSCRIBE_TEMPLATES.some((template) =>
    template.templateKey === value,
  );
}

// 三个正式模板在公众平台选用关键词后，由微信分配的字段布局各不相同
//（已通过 newtmpl/gettemplate 核对；换模板时需同步调整这里）：
// - 服务工单通知（REQUEST_REPLY）：工单标题 thing2 + 工单内容 thing3
// - 工单进度提醒（REQUEST_STATUS）：工单标题 thing5 + 工单状态 phrase1（≤5 字短语）
// - 项目进度提醒（PROJECT_UPDATE）：项目名称 thing1 + 备注 thing10
export function buildSubscribeMessageData(
  templateKey: WechatTemplateKey,
  title: string,
  body: string,
): Record<string, string> {
  switch (templateKey) {
    case "REQUEST_REPLY":
      return {
        thing2: clipWechatThing(title),
        thing3: clipWechatThing(body),
      };
    case "REQUEST_STATUS": {
      // 入队时 body 形如 `${request.title} · ${状态标签}`；
      // phrase1 只装得下状态标签（待处理/处理中/等待您回复/已解决/已关闭）
      const separator = body.lastIndexOf(" · ");
      const statusLabel = separator >= 0 ? body.slice(separator + 3) : body;
      return {
        thing5: clipWechatThing(title),
        phrase1: clipWechatPhrase(statusLabel),
      };
    }
    case "PROJECT_UPDATE":
      return {
        thing1: clipWechatThing(title),
        thing10: clipWechatThing(body),
      };
  }
}

/**
 * 通知落库后的同事务入队（由 createNotification 调用）。
 * 订阅消息只是提醒渠道：前置不满足（规则关闭/未绑定/无额度/类型不匹配）
 * 一律静默跳过返回 false；幂等去重靠 eventKey 唯一约束 +
 * createMany skipDuplicates（数据库层 ON CONFLICT DO NOTHING，不产生 SQL 错误）。
 * 不再 try/catch：PG 里语句失败即事务 aborted，catch 掩盖不了任何东西，
 * 只会把真正的故障推迟成下一条语句的 25P02——基础设施错误应连同业务事务
 * 一起失败并保留原始错误。
 */
export async function recordWechatSubscribeDelivery(
  tx: Prisma.TransactionClient,
  notification: {
    id: string;
    occurrenceCount: number;
    type: NotificationType;
    title: string;
    body: string;
    userId: string;
    projectId: string | null;
    serviceRequestId: string | null;
  },
): Promise<boolean> {
  const definition = WECHAT_SUBSCRIBE_TEMPLATES.find((template) =>
    template.notificationTypes.includes(notification.type),
  );
  if (!definition) return false;

  const rule = await tx.notificationDeliveryRule.findUnique({
    where: { key: definition.ruleKey },
    select: { wechatEnabled: true },
  });
  const wechatEnabled =
    rule?.wechatEnabled ??
    defaultNotificationDeliveryRuleState(definition.ruleKey).wechatEnabled;
  if (!wechatEnabled) return false;

  const binding = await tx.wechatBinding.findUnique({
    where: { userId: notification.userId },
    select: { id: true },
  });
  if (!binding) return false;

  const grant = await tx.wechatSubscribeGrant.findUnique({
    where: {
      userId_templateKey: {
        userId: notification.userId,
        templateKey: definition.templateKey,
      },
    },
    select: { remaining: true },
  });
  if (!grant || grant.remaining <= 0) return false;

  const page = notification.serviceRequestId
    ? `/pages/request-detail/page?id=${notification.serviceRequestId}`
    : notification.projectId
      ? `/pages/project-detail/page?id=${notification.projectId}`
      : null;

  const eventKey = `wechat:${notification.id}:${notification.occurrenceCount}`;
  const inserted = await tx.wechatSubscribeMessageDelivery.createMany({
    data: [
      {
        eventKey,
        templateKey: definition.templateKey,
        userId: notification.userId,
        requestId: notification.serviceRequestId,
        title: notification.title.slice(0, 200),
        body: notification.body.slice(0, 500),
        page,
      },
    ],
    skipDuplicates: true,
  });
  if (inserted.count > 0) {
    // 提交后唤醒 worker（与钉钉投递同模式；断连时由每分钟 sweep 兜底）。
    // 载荷必须是投递行 id：监听方按 id 直接入队处理，发通知 id 会静默落空
    const delivery = await tx.wechatSubscribeMessageDelivery.findUnique({
      where: { eventKey },
      select: { id: true },
    });
    if (delivery) {
      await tx.$executeRaw`SELECT pg_notify('service_platform_wechat_deliveries', ${delivery.id})`;
    }
  }
  return inserted.count > 0;
}

const GRANT_REPORT_THROTTLE_MS = 60 * 1000;
const GRANT_MAX_REMAINING = 30;

/**
 * 读取当前用户各订阅模板的剩余额度，供小程序展示真实订阅状态与顶部引导横幅。
 * 与入队门槛（recordWechatSubscribeDelivery 里的 grant.remaining）同源：
 * 无 grant 行视为 0，封顶 GRANT_MAX_REMAINING，保证前端判定与真实可发送额度一致。
 */
export async function listSubscribeGrants(
  userId: string,
): Promise<Array<{ templateKey: WechatTemplateKey; remaining: number }>> {
  const rows = await prisma.wechatSubscribeGrant.findMany({
    where: { userId },
    select: { templateKey: true, remaining: true },
  });
  const remainingByKey = new Map(
    rows.map((row) => [row.templateKey, row.remaining]),
  );
  return WECHAT_SUBSCRIBE_TEMPLATES.map((template) => ({
    templateKey: template.templateKey,
    remaining: Math.min(
      Math.max(remainingByKey.get(template.templateKey) ?? 0, 0),
      GRANT_MAX_REMAINING,
    ),
  }));
}

/**
 * 客户端上报 wx.requestSubscribeMessage 授权结果。
 * 上报只是「额度状态」而非权限凭证：同一模板 60s 内重复上报被节流，
 * 累计额度封顶；真实额度以微信发送结果修正（43101 未订阅时清零）。
 *
 * 上报与「解绑」必须全序：解绑会同事务删除全部授权（旧 openid 额度不延续），
 * 并发上报若在删除后落库会重建孤儿额度，换绑后被 worker 当作可用配额误发。
 * 这里取与绑定生命周期相同的 per-user 咨询锁，并在事务内重验绑定仍存在。
 */
export async function reportSubscribeGrant(
  userId: string,
  templateKey: WechatTemplateKey,
): Promise<{ remaining: number }> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      SELECT pg_advisory_xact_lock(hashtext(${`wechat-binding-code:${userId}`}))
    `;
    const binding = await tx.wechatBinding.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!binding) return { remaining: 0 };
    const existing = await tx.wechatSubscribeGrant.findUnique({
      where: { userId_templateKey: { userId, templateKey } },
      select: { remaining: true, lastReportedAt: true },
    });
    const now = new Date();
    if (
      existing?.lastReportedAt &&
      now.getTime() - existing.lastReportedAt.getTime() < GRANT_REPORT_THROTTLE_MS
    ) {
      return { remaining: existing.remaining };
    }
    if (existing && existing.remaining >= GRANT_MAX_REMAINING) {
      await tx.wechatSubscribeGrant.update({
        where: { userId_templateKey: { userId, templateKey } },
        data: { lastReportedAt: now },
      });
      return { remaining: existing.remaining };
    }
    const updated = await tx.wechatSubscribeGrant.upsert({
      where: { userId_templateKey: { userId, templateKey } },
      create: { userId, templateKey, remaining: 1, lastReportedAt: now },
      update: { remaining: { increment: 1 }, lastReportedAt: now },
      select: { remaining: true },
    });
    return { remaining: Math.min(updated.remaining, GRANT_MAX_REMAINING) };
  }, { maxWait: 10_000, timeout: 60_000 });
}
