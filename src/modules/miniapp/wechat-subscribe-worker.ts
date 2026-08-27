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
  const templateKey = isWechatTemplateKey(delivery.templateKey)
    ? delivery.templateKey
    : null;
  if (!templateKey) {
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
  const templateId = templateIdFor(templateKey);
  if (!templateId) {
    await finish("SKIPPED", "订阅消息模板未配置");
    return;
  }
  // —— 发送与结果修正（同一事务、同一把锁）——
  // 读绑定到网络发送之间不能与解绑并发：否则解绑可在发送提交前完成，
  // 通知仍按旧 openid 发出，把工单/项目内容泄露给已解绑的微信号。
  // 发送产生的额度修正也必须留在锁内：若锁释放后「解绑 → 换绑 → 上报新额度」
  // 先提交，旧 openid 的投递结果会错误作用于新绑定的授权（成功误扣、43101 误清零）。
  let skipped: string | null = null;
  await prisma
    .$transaction(
      async (tx) => {
        await tx.$executeRaw`
          SELECT pg_advisory_xact_lock(hashtext(${`wechat-binding-code:${delivery.userId}`}))
        `;
        // 锁内重验：解绑可能已在我们排队等锁时提交，删除了绑定与授权
        const bindingNow = await tx.wechatBinding.findUnique({
          where: { userId: delivery.userId },
          select: { openid: true },
        });
        if (!bindingNow) {
          skipped = "用户已解绑微信";
          return;
        }
        const grantNow = await tx.wechatSubscribeGrant.findUnique({
          where: {
            userId_templateKey: { userId: delivery.userId, templateKey },
          },
          select: { remaining: true },
        });
        if (!grantNow || grantNow.remaining <= 0) {
          skipped = "无剩余订阅额度";
          return;
        }

        // 发送在锁的保护之下进行：解绑事务会阻塞等本次网络往返提交后再执行。
        // 字段键按所选模板的实际布局构造（thing2/thing3、thing5/phrase1、thing1/thing10）
        const result = await send({
          openid: bindingNow.openid,
          templateId,
          data: buildSubscribeMessageData(
            templateKey,
            delivery.title,
            delivery.body,
          ),
          page: delivery.page,
        });

        if (result.outcome === "SENT") {
          await tx.wechatSubscribeMessageDelivery.update({
            where: { id: delivery.id },
            data: {
              status: "DELIVERED",
              lastError: null,
              deliveredAt: new Date(),
            },
          });
          await tx.wechatSubscribeGrant.updateMany({
            where: { userId: delivery.userId, templateKey, remaining: { gt: 0 } },
            data: { remaining: { decrement: 1 } },
          });
          return;
        }
        if (result.outcome === "USER_NOT_SUBSCRIBED") {
          await tx.wechatSubscribeMessageDelivery.update({
            where: { id: delivery.id },
            data: {
              status: "SKIPPED",
              lastError: "用户未订阅该消息（43101），额度已清零",
              deliveredAt: null,
            },
          });
          await tx.wechatSubscribeGrant.updateMany({
            where: { userId: delivery.userId, templateKey },
            data: { remaining: 0 },
          });
          return;
        }
        if (result.outcome === "FATAL") {
          // 无效 openid（40003）/模板（40037）等不可恢复错误：重试必然再失败，
          // 立即定稿 FAILED，不做无谓的重复外发
          await tx.wechatSubscribeMessageDelivery.update({
            where: { id: delivery.id },
            data: {
              status: "FAILED",
              lastError: result.message.slice(0, 500),
              deliveredAt: null,
            },
          });
          return;
        }
        const isFinal =
          options.finalAttempt || delivery.attemptCount >= MAX_ATTEMPTS;
        if (isFinal) {
          await tx.wechatSubscribeMessageDelivery.update({
            where: { id: delivery.id },
            data: {
              status: "FAILED",
              lastError: result.message.slice(0, 500),
              deliveredAt: null,
            },
          });
          return;
        }
        const delay =
          RETRY_DELAYS_MS[
            Math.min(delivery.attemptCount - 1, RETRY_DELAYS_MS.length - 1)
          ] ?? RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1]!;
        await tx.wechatSubscribeMessageDelivery.update({
          where: { id: delivery.id },
          data: {
            status: "PENDING",
            lastError: result.message.slice(0, 500),
            deliveredAt: null,
            nextAttemptAt: new Date(Date.now() + delay),
          },
        });
      },
      {
        // 微信侧最长可消耗 token 8s + 消息 8s，还需覆盖排队等锁时间：
        // 默认 5s 交互式事务超时会在网络往返中回滚整个事务——投递卡在
        // PROCESSING，15 分钟后被僵尸回收重复外发。显式放宽覆盖完整路径。
        maxWait: 10_000,
        timeout: 45_000,
      },
    )
    .catch((error: unknown) => {
      // 事务回滚后 claim 仍在（PROCESSING）：交给 stale 超时机制重新捞起重投
      console.error("[wechat-subscribe] delivery transaction failed:", error);
    });

  if (skipped) {
    await finish("SKIPPED", skipped);
  }
}
