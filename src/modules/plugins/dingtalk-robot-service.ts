import "server-only";

import { randomUUID } from "node:crypto";
import {
  sendDingTalkTicketNotification,
  type DingTalkTicketEventType,
} from "@achord/plugin-dingtalk-robot/runtime";
import { parseDingTalkRobotBinding } from "@achord/plugin-dingtalk-robot/config";
import {
  parseDingTalkRobotTemplate,
  type DingTalkRobotTemplate,
} from "@achord/plugin-dingtalk-robot/config";
import type { Prisma } from "@/generated/prisma/client";
import { env } from "@/lib/runtime-env";
import { withSystemDb } from "@/lib/system-db";
import {
  decryptPluginSecretConfig,
  fingerprintPluginConfiguration,
} from "@/modules/plugins/plugin-secret-config";
import {
  DINGTALK_ROBOT_PLUGIN_KEY,
  registeredPluginHealthConfig,
  tryParseRegisteredPluginConfig,
} from "@/modules/plugins/plugin-registry";

const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 60 * 60_000];
const PROCESSING_STALE_MS = 10 * 60_000;
const EVENT_TYPES = new Set<DingTalkTicketEventType>([
  "REQUEST_CREATED",
  "REQUEST_CUSTOMER_REPLIED",
]);

const DELIVERY_RULE_KEYS: Record<DingTalkTicketEventType, string> = {
  REQUEST_CREATED: "REQUEST_CREATED",
  REQUEST_CUSTOMER_REPLIED: "REQUEST_PUBLIC_MESSAGE",
};

type DeliveryPayload = {
  actorName?: string | null;
  occurredAt: string;
  template?: DingTalkRobotTemplate;
};

export async function recordDingTalkRobotDelivery(
  tx: Prisma.TransactionClient,
  input: {
    eventKey: string;
    eventType: DingTalkTicketEventType;
    requestId: string;
    actorName?: string | null;
    occurredAt?: Date;
  },
) {
  const payload = JSON.stringify({
    actorName: input.actorName ?? null,
    occurredAt: (input.occurredAt ?? new Date()).toISOString(),
  });
  const [result] = await tx.$queryRaw<
    Array<{
      deliveryId: string | null;
      outcome: "CREATED" | "DUPLICATE" | "DISABLED" | "DENIED" | "INVALID" | "ERROR";
      errorCode: string | null;
    }>
  >`
    SELECT * FROM app_enqueue_dingtalk_robot_delivery(
      ${randomUUID()},
      ${input.eventKey},
      ${input.eventType},
      ${input.requestId},
      ${payload}::jsonb
    )
  `;
  if (
    !result ||
    result.outcome === "ERROR" ||
    result.outcome === "INVALID" ||
    result.outcome === "DENIED"
  ) {
    console.error(
      "ACHORD_DINGTALK_OUTBOX_ENQUEUE_FAILED",
      JSON.stringify({
        event: "dingtalk.outbox_enqueue_failed",
        eventType: input.eventType,
        requestId: input.requestId,
        outcome: result?.outcome ?? "NO_RESULT",
        errorCode: result?.errorCode ?? "NO_RESULT",
      }),
    );
  }
  return result?.deliveryId ?? null;
}

export async function listDueDingTalkRobotDeliveries() {
  const now = new Date();
  return withSystemDb(async (tx) => {
    await tx.dingTalkRobotDelivery.updateMany({
      where: {
        status: { in: ["PENDING", "PROCESSING"] },
        attemptCount: { gte: 5 },
      },
      data: {
        status: "FAILED",
        nextAttemptAt: null,
        lastError: "钉钉机器人发送已达到重试上限",
      },
    });
    await tx.dingTalkRobotDelivery.updateMany({
      where: {
        status: "PROCESSING",
        attemptCount: { lt: 5 },
        lastAttemptAt: {
          lt: new Date(now.getTime() - PROCESSING_STALE_MS),
        },
      },
      data: {
        status: "PENDING",
        nextAttemptAt: now,
        lastError: "上次投递进程中断，已重新排队",
      },
    });
    return tx.dingTalkRobotDelivery.findMany({
      where: {
        status: "PENDING",
        OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
      },
      select: { id: true, nextAttemptAt: true },
      orderBy: [{ nextAttemptAt: "asc" }, { createdAt: "asc" }],
      take: 100,
    });
  });
}

export async function processDingTalkRobotDelivery(
  deliveryId: string,
  options: {
    finalAttempt: boolean;
    send?: typeof sendDingTalkTicketNotification;
  },
) {
  const attemptAt = new Date();
  const claimed = await withSystemDb(async (tx) => {
    const result = await tx.dingTalkRobotDelivery.updateMany({
      where: {
        id: deliveryId,
        status: "PENDING",
        attemptCount: { lt: 5 },
        OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: attemptAt } }],
      },
      data: {
        status: "PROCESSING",
        attemptCount: { increment: 1 },
        lastAttemptAt: attemptAt,
        nextAttemptAt: null,
        lastError: null,
      },
    });
    if (result.count === 0) return null;
    return tx.dingTalkRobotDelivery.findUnique({ where: { id: deliveryId } });
  });
  if (!claimed) return { id: deliveryId, skipped: true };

  const context = await withSystemDb(async (tx) => {
    const eventType = EVENT_TYPES.has(
      claimed.eventType as DingTalkTicketEventType,
    )
      ? (claimed.eventType as DingTalkTicketEventType)
      : null;
    const installation = await tx.pluginInstallation.findUnique({
      where: { key: DINGTALK_ROBOT_PLUGIN_KEY },
      select: {
        enabled: true,
        config: true,
        healthStatus: true,
        healthConfigFingerprint: true,
        secretConfigEncrypted: true,
      },
    });
    const request = await tx.serviceRequest.findUnique({
      where: { id: claimed.requestId },
      select: {
        id: true,
        number: true,
        title: true,
        priority: true,
        project: {
          select: {
            title: true,
            customerSpace: { select: { name: true } },
          },
        },
      },
    });
    const deliveryRule = eventType
      ? await tx.notificationDeliveryRule.findUnique({
          where: { key: DELIVERY_RULE_KEYS[eventType] },
          select: { dingtalkEnabled: true },
        })
      : null;
    return { installation, request, deliveryRule, eventType };
  });

  if (
    !context.eventType ||
    !context.deliveryRule?.dingtalkEnabled ||
    !context.installation?.enabled ||
    context.installation.healthStatus !== "READY" ||
    !context.installation.healthConfigFingerprint ||
    !context.installation.secretConfigEncrypted ||
    !context.request
  ) {
    await finishDelivery(
      deliveryId,
      attemptAt,
      "钉钉规则已关闭、插件配置失效或工单不存在",
    );
    return { id: deliveryId, skipped: true };
  }

  try {
    const binding = parseDingTalkRobotBinding(
      decryptPluginSecretConfig(context.installation.secretConfigEncrypted),
    );
    const configCheck = tryParseRegisteredPluginConfig(
      DINGTALK_ROBOT_PLUGIN_KEY,
      context.installation.config,
    );
    if (
      !configCheck.ok ||
      fingerprintPluginConfiguration(
        registeredPluginHealthConfig(
          DINGTALK_ROBOT_PLUGIN_KEY,
          configCheck.config,
        ),
        binding,
      ) !==
        context.installation.healthConfigFingerprint
    ) {
      await finishDelivery(deliveryId, attemptAt, "插件配置尚未通过运行环境检测");
      return { id: deliveryId, skipped: true };
    }
    const payload = parseDeliveryPayload(claimed.payload);
    const priorityLabels = {
      LOW: "低",
      NORMAL: "普通",
      HIGH: "高",
      URGENT: "紧急",
    } as const;
    await (options.send ?? sendDingTalkTicketNotification)(
      binding,
      {
        type: context.eventType,
        requestId: context.request.id,
        requestNumber: context.request.number,
        title: context.request.title,
        requestUrl: `${env.APP_URL.replace(/\/$/, "")}/staff/requests/${context.request.id}`,
        customerName: context.request.project.customerSpace.name,
        projectName: context.request.project.title,
        priorityLabel: priorityLabels[context.request.priority],
        actorName: payload.actorName,
        occurredAt: payload.occurredAt,
      },
      { template: payload.template },
    );
    const completed = await withSystemDb((tx) =>
      tx.dingTalkRobotDelivery.updateMany({
        where: {
          id: deliveryId,
          status: "PROCESSING",
          lastAttemptAt: attemptAt,
        },
        data: {
          status: "DELIVERED",
          deliveredAt: new Date(),
          nextAttemptAt: null,
          lastError: null,
        },
      }),
    );
    if (completed.count === 0) {
      return { id: deliveryId, delivered: true, stateChanged: false };
    }
    return { id: deliveryId, delivered: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "钉钉机器人发送失败";
    const finalAttempt = options.finalAttempt || claimed.attemptCount >= 5;
    const delay =
      RETRY_DELAYS_MS[
        Math.min(claimed.attemptCount - 1, RETRY_DELAYS_MS.length - 1)
      ];
    const failed = await withSystemDb((tx) =>
      tx.dingTalkRobotDelivery.updateMany({
        where: {
          id: deliveryId,
          status: "PROCESSING",
          lastAttemptAt: attemptAt,
        },
        data: {
          status: finalAttempt ? "FAILED" : "PENDING",
          nextAttemptAt: finalAttempt ? null : new Date(Date.now() + delay),
          lastError: message.slice(0, 500),
        },
      }),
    );
    if (failed.count === 0) {
      return { id: deliveryId, skipped: true };
    }
    throw error;
  }
}

function parseDeliveryPayload(value: Prisma.JsonValue): DeliveryPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { occurredAt: new Date().toISOString() };
  }
  return {
    actorName:
      typeof value.actorName === "string" ? value.actorName : null,
    occurredAt:
      typeof value.occurredAt === "string"
        ? value.occurredAt
        : new Date().toISOString(),
    template: parsePayloadTemplate(value.template),
  };
}

function parsePayloadTemplate(value: unknown) {
  try {
    return parseDingTalkRobotTemplate(value);
  } catch {
    return undefined;
  }
}

function finishDelivery(id: string, claimAt: Date, lastError: string) {
  return withSystemDb((tx) =>
    tx.dingTalkRobotDelivery.updateMany({
      where: { id, status: "PROCESSING", lastAttemptAt: claimAt },
      data: { status: "SKIPPED", lastError, nextAttemptAt: null },
    }),
  );
}
