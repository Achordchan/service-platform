import "server-only";

import { prisma } from "@/lib/db";
import {
  sendSubscribeMessageViaWechat,
  type WechatSubscribeSender,
} from "@/modules/miniapp/wechat-api-client";
import {
  defaultNotificationDeliveryRuleState,
} from "@/modules/notifications/notification-delivery-rules";
import {
  buildSubscribeMessageData,
  isWechatTemplateKey,
  templateIdFor,
  WECHAT_SUBSCRIBE_TEMPLATES,
} from "@/modules/miniapp/wechat-subscribe-message-service";

const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 30 * 60_000];
const MAX_ATTEMPTS = 4;
// claim 后进程崩溃/部署重启会让投递卡在 PROCESSING；超时后重新捞起（同邮件 outbox 模式）
export const WECHAT_PROCESSING_CLAIM_STALE_MS = 15 * 60 * 1000;

function dueDeliveryWhere() {
  const now = new Date();
  return {
    OR: [
      {
        status: "PENDING" as const,
        OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
      },
      {
        status: "PROCESSING" as const,
        lastAttemptAt: {
          lt: new Date(now.getTime() - WECHAT_PROCESSING_CLAIM_STALE_MS),
        },
      },
    ],
  };
}

export function listDueWechatSubscribeDeliveries() {
  return prisma.wechatSubscribeMessageDelivery.findMany({
    where: {
      ...dueDeliveryWhere(),
      attemptCount: { lt: MAX_ATTEMPTS },
    },
    select: { id: true },
    orderBy: { createdAt: "asc" },
    take: 100,
  });
}

/**
 * 处理一条订阅消息投递：原子 claim → 复查前置（规则开关/绑定/额度/模板）
 * → 发送 → 按微信实际结果修正额度（成功 -1；43101 清零）。
 * 订阅消息只是提醒渠道：任何失败都不影响已成功的业务操作。
 */
export async function processWechatSubscribeMessageDelivery(
  deliveryId: string,
  options: {
    finalAttempt?: boolean;
    send?: WechatSubscribeSender;
  } = {},
): Promise<void> {
  const send = options.send ?? sendSubscribeMessageViaWechat;
  const claimed = await prisma.wechatSubscribeMessageDelivery.updateMany({
    where: {
      id: deliveryId,
      ...dueDeliveryWhere(),
      attemptCount: { lt: MAX_ATTEMPTS },
    },
    data: {
      status: "PROCESSING",
      attemptCount: { increment: 1 },
      lastAttemptAt: new Date(),
    },
  });
  if (claimed.count === 0) return;

  const delivery = await prisma.wechatSubscribeMessageDelivery.findUnique({
    where: { id: deliveryId },
    select: {
      id: true,
      templateKey: true,
      userId: true,
      title: true,
      body: true,
      page: true,
      attemptCount: true,
    },
  });
  if (!delivery) return;

  const finish = (status: "DELIVERED" | "FAILED" | "SKIPPED" | "PENDING", error?: string, retryDelayMs?: number) =>
    prisma.wechatSubscribeMessageDelivery
      .update({
        where: { id: delivery.id },
        data: {
          status,
          lastError: error ? error.slice(0, 500) : null,
          deliveredAt: status === "DELIVERED" ? new Date() : null,
          ...(status === "PENDING" && retryDelayMs
            ? { nextAttemptAt: new Date(Date.now() + retryDelayMs) }
            : {}),
        },
      })
      .catch(() => undefined);

  // —— 复查前置（入队后开关/额度可能已变化）——
  if (!isWechatTemplateKey(delivery.templateKey)) {
    await finish("SKIPPED", "未知模板");
    return;
  }
  const definition = WECHAT_SUBSCRIBE_TEMPLATES.find(
    (template) => template.templateKey === delivery.templateKey,
  )!;
  const rule = await prisma.notificationDeliveryRule.findUnique({
    where: { key: definition.ruleKey },
    select: { wechatEnabled: true },
  });
  const wechatEnabled =
    rule?.wechatEnabled ??
    defaultNotificationDeliveryRuleState(definition.ruleKey).wechatEnabled;
  if (!wechatEnabled) {
    await finish("SKIPPED", "规则已关闭");
    return;
  }
  const binding = await prisma.wechatBinding.findUnique({
    where: { userId: delivery.userId },
    select: { openid: true },
  });
  if (!binding) {
    await finish("SKIPPED", "用户已解绑微信");
    return;
  }
  const grant = await prisma.wechatSubscribeGrant.findUnique({
    where: {
      userId_templateKey: {
        userId: delivery.userId,
        templateKey: delivery.templateKey,
      },
    },
    select: { remaining: true },
  });
  if (!grant || grant.remaining <= 0) {
    await finish("SKIPPED", "无剩余订阅额度");
    return;
  }
  const templateId = templateIdFor(delivery.templateKey);
  if (!templateId) {
    await finish("SKIPPED", "订阅消息模板未配置");
    return;
  }

  // —— 发送与额度修正 ——
  const result = await send({
    openid: binding.openid,
    templateId,
    // 字段键按所选模板的实际布局构造（thing2/thing3、thing5/phrase1、thing1/thing10）
    data: buildSubscribeMessageData(
      delivery.templateKey,
      delivery.title,
      delivery.body,
    ),
    page: delivery.page,
  });
  if (result.outcome === "SENT") {
    // 单事务完成「标记已投递 + 扣减额度」，避免两步间崩溃导致状态不一致。
    // 交互式顺序执行：数组形式 $transaction 会在同一客户端上并行发送两条查询（pg 重入警告）
    await prisma
      .$transaction(async (tx) => {
        await tx.wechatSubscribeMessageDelivery.update({
          where: { id: delivery.id },
          data: {
            status: "DELIVERED",
            lastError: null,
            deliveredAt: new Date(),
          },
        });
        await tx.wechatSubscribeGrant.updateMany({
          where: {
            userId: delivery.userId,
            templateKey: delivery.templateKey,
            remaining: { gt: 0 },
          },
          data: { remaining: { decrement: 1 } },
        });
      })
      .catch((error: unknown) => {
        console.error("[wechat-subscribe] mark delivered failed:", error);
      });
    return;
  }
  if (result.outcome === "USER_NOT_SUBSCRIBED") {
    await finish("SKIPPED", "用户未订阅该消息（43101），额度已清零");
    await prisma.wechatSubscribeGrant
      .updateMany({
        where: { userId: delivery.userId, templateKey: delivery.templateKey },
        data: { remaining: 0 },
      })
      .catch(() => undefined);
    return;
  }
  if (result.outcome === "FATAL") {
    await finish("FAILED", result.message);
    return;
  }
  const isFinal =
    options.finalAttempt || delivery.attemptCount >= MAX_ATTEMPTS;
  if (isFinal) {
    await finish("FAILED", result.message);
    return;
  }
  const delay =
    RETRY_DELAYS_MS[Math.min(delivery.attemptCount - 1, RETRY_DELAYS_MS.length - 1)] ??
    RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1]!;
  await finish("PENDING", result.message, delay);
}
