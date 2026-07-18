import "server-only";

import { randomUUID } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import type { Actor } from "@/lib/actor";
import { withActorDb } from "@/lib/actor";
import { UNIVERSAL_PLUGIN_KEY } from "@/modules/integrations/universal/constants";
import { assertCanManageProjectDelivery } from "@/modules/projects/project-access";
import {
  assertAllowed,
  assertFound,
  DomainError,
} from "@/modules/projects/errors";

function serializeDelivery(delivery: {
  id: string;
  eventId: string;
  eventType: string;
  payload: unknown;
  status: string;
  attemptCount: number;
  nextAttemptAt: Date | null;
  lastAttemptAt: Date | null;
  responseStatus: number | null;
  lastError: string | null;
  deliveredAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    ...delivery,
    nextAttemptAt: delivery.nextAttemptAt?.toISOString() ?? null,
    lastAttemptAt: delivery.lastAttemptAt?.toISOString() ?? null,
    deliveredAt: delivery.deliveredAt?.toISOString() ?? null,
    createdAt: delivery.createdAt.toISOString(),
    updatedAt: delivery.updatedAt.toISOString(),
  };
}

async function findConnectionForProject(
  tx: Prisma.TransactionClient,
  projectId: string,
) {
  return tx.universalConnectorConnection.findFirst({
    where: {
      binding: { projectId, pluginKey: UNIVERSAL_PLUGIN_KEY },
    },
    include: { binding: { include: { plugin: true, project: true } } },
  });
}

export function listUniversalWebhookDeliveries(
  actor: Actor,
  projectId: string,
  limit = 50,
) {
  return withActorDb(actor, async (tx) => {
    await assertCanManageProjectDelivery(tx, actor, projectId);
    const connection = await findConnectionForProject(tx, projectId);
    assertFound(connection, "通用连接不存在");
    const deliveries = await tx.universalWebhookDelivery.findMany({
      where: { bindingId: connection.bindingId },
      orderBy: { createdAt: "desc" },
      take: Math.min(Math.max(limit, 1), 100),
    });
    return deliveries.map(serializeDelivery);
  });
}

export function createUniversalWebhookTest(actor: Actor, projectId: string) {
  assertAllowed(actor.isPlatformAdmin);
  return withActorDb(actor, async (tx) => {
    const connection = await findConnectionForProject(tx, projectId);
    assertFound(connection, "通用连接不存在");
    if (
      !connection.binding.plugin.enabled ||
      connection.binding.plugin.healthStatus !== "READY" ||
      connection.binding.status === "ARCHIVED"
    ) {
      throw new DomainError(
        "UNIVERSAL_CONNECTION_UNAVAILABLE",
        "插件或连接当前不可用",
        409,
      );
    }
    if (!connection.webhookUrl || !connection.webhookSecretEncrypted) {
      throw new DomainError(
        "UNIVERSAL_WEBHOOK_NOT_CONFIGURED",
        "请先保存 Webhook 地址并生成签名密钥",
        409,
      );
    }
    const eventId = randomUUID();
    const delivery = await tx.universalWebhookDelivery.create({
      data: {
        bindingId: connection.bindingId,
        eventId,
        eventType: "connector.test",
        payload: {
          id: eventId,
          type: "connector.test",
          createdAt: new Date().toISOString(),
          data: {
            projectId: connection.binding.projectId,
            connectionName: connection.name,
          },
        },
      },
    });
    await tx.$executeRaw`
      SELECT pg_notify('service_platform_webhook_deliveries', ${delivery.id})
    `;
    return serializeDelivery(delivery);
  });
}

export function retryUniversalWebhookDelivery(
  actor: Actor,
  projectId: string,
  deliveryId: string,
) {
  assertAllowed(actor.isPlatformAdmin);
  return withActorDb(actor, async (tx) => {
    const connection = await findConnectionForProject(tx, projectId);
    assertFound(connection, "通用连接不存在");
    const existing = await tx.universalWebhookDelivery.findFirst({
      where: { id: deliveryId, bindingId: connection.bindingId },
    });
    assertFound(existing, "Webhook 投递记录不存在");
    if (existing.status !== "FAILED") {
      throw new DomainError(
        "UNIVERSAL_WEBHOOK_NOT_RETRYABLE",
        "只有失败的 Webhook 投递可以重新执行",
        409,
      );
    }
    const updated = await tx.universalWebhookDelivery.update({
      where: { id: existing.id },
      data: {
        status: "PENDING",
        attemptCount: 0,
        nextAttemptAt: null,
        lastAttemptAt: null,
        responseStatus: null,
        lastError: null,
        deliveredAt: null,
      },
    });
    await tx.$executeRaw`
      SELECT pg_notify('service_platform_webhook_deliveries', ${updated.id})
    `;
    return serializeDelivery(updated);
  });
}
