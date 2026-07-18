import "server-only";

import { randomUUID } from "node:crypto";
import type { EventType, Prisma } from "@/generated/prisma/client";
import { htmlToPlainText } from "@/lib/message-content";
import { decryptSecret } from "@/lib/secret-crypto";
import { withSystemDb } from "@/lib/system-db";
import {
  UNIVERSAL_WEBHOOK_MAX_ATTEMPTS,
  UNIVERSAL_WEBHOOK_PROCESSING_STALE_MS,
  UNIVERSAL_WEBHOOK_RETRY_DELAYS_MS,
  type UniversalWebhookEventType,
} from "@/modules/integrations/universal/constants";
import { postUniversalWebhook } from "@/modules/integrations/universal/webhook-client";
import { DomainError } from "@/modules/projects/errors";

type RequestEventInput = {
  eventType: Extract<
    EventType,
    "REQUEST_CREATED" | "REQUEST_MESSAGE_CREATED" | "REQUEST_STATUS_CHANGED"
  >;
  eventPayload: Prisma.InputJsonValue;
  serviceRequestId: string;
};

function objectPayload(value: Prisma.InputJsonValue) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Prisma.InputJsonObject)
    : {};
}

async function enqueueDelivery(
  tx: Prisma.TransactionClient,
  input: {
    serviceRequestId: string;
    eventType: UniversalWebhookEventType;
    payload: Prisma.InputJsonObject;
  },
) {
  const eventId = String(input.payload.id);
  const deliveryId = randomUUID();
  const [created] = await tx.$queryRaw<Array<{ delivery_id: string | null }>>`
    SELECT app_enqueue_universal_webhook(
      ${deliveryId},
      ${input.serviceRequestId},
      ${eventId},
      ${input.eventType},
      ${input.payload}::jsonb
    ) AS delivery_id
  `;
  return created?.delivery_id ?? null;
}

export async function recordUniversalRequestWebhook(
  tx: Prisma.TransactionClient,
  input: RequestEventInput,
) {
  const eventPayload = objectPayload(input.eventPayload);
  if (
    input.eventType === "REQUEST_MESSAGE_CREATED" &&
    eventPayload.visibility !== "CUSTOMER_VISIBLE"
  ) {
    return null;
  }
  const request = await tx.serviceRequest.findUnique({
    where: { id: input.serviceRequestId },
    select: {
      id: true,
      number: true,
      title: true,
      status: true,
      createdByExternalContact: {
        select: { id: true, externalUserId: true },
      },
    },
  });
  if (!request?.createdByExternalContact) return null;

  let eventType: UniversalWebhookEventType;
  let data: Prisma.InputJsonObject = {
    externalUserId: request.createdByExternalContact.externalUserId,
    request: {
      id: request.id,
      number: request.number,
      title: request.title,
      status: request.status,
    },
  };
  if (input.eventType === "REQUEST_CREATED") {
    eventType = "request.created";
  } else if (input.eventType === "REQUEST_STATUS_CHANGED") {
    eventType = "request.status.changed";
    data = {
      ...data,
      previousStatus: String(eventPayload.previousStatus ?? ""),
      status: String(eventPayload.status ?? request.status),
    };
  } else {
    const messageId = String(eventPayload.messageId ?? "");
    if (!messageId) return null;
    const message = await tx.requestMessage.findFirst({
      where: {
        id: messageId,
        serviceRequestId: request.id,
        visibility: "CUSTOMER_VISIBLE",
      },
      select: {
        id: true,
        body: true,
        createdAt: true,
        externalAuthorId: true,
        attachments: {
          where: { visibility: "CUSTOMER_VISIBLE" },
          select: { originalName: true },
          orderBy: { createdAt: "asc" },
        },
      },
    });
    if (!message) return null;
    eventType = "request.public_message.created";
    data = {
      ...data,
      message: {
        id: message.id,
        text: htmlToPlainText(message.body).slice(0, 20_000),
        attachmentNames: message.attachments.map((item) => item.originalName),
        authorType: message.externalAuthorId
          ? "EXTERNAL_CONTACT"
          : "ACHORD_USER",
        createdAt: message.createdAt.toISOString(),
      },
    };
    if (!message.externalAuthorId) {
      const contactId = request.createdByExternalContact.id;
      const activePresence = await tx.externalRequestPresence.findFirst({
        where: {
          serviceRequestId: request.id,
          externalContactId: contactId,
          expiresAt: { gt: new Date() },
        },
        select: { id: true },
      });
      const currentReadState = await tx.externalRequestReadState.findUnique({
        where: {
          serviceRequestId_externalContactId: {
            serviceRequestId: request.id,
            externalContactId: contactId,
          },
        },
        select: { unreadCount: true },
      });
      if (activePresence) {
        if ((currentReadState?.unreadCount ?? 0) > 0) {
          await tx.externalRequestReadState.update({
            where: {
              serviceRequestId_externalContactId: {
                serviceRequestId: request.id,
                externalContactId: contactId,
              },
            },
            data: { unreadCount: 0, lastReadAt: new Date() },
          });
          await recordUniversalUnreadWebhook(tx, {
            serviceRequestId: request.id,
            externalUserId: request.createdByExternalContact.externalUserId,
            unreadCount: 0,
          });
        }
      } else {
        const readState = await tx.externalRequestReadState.upsert({
          where: {
            serviceRequestId_externalContactId: {
              serviceRequestId: request.id,
              externalContactId: contactId,
            },
          },
          create: {
            serviceRequestId: request.id,
            externalContactId: contactId,
            unreadCount: 1,
          },
          update: { unreadCount: { increment: 1 } },
          select: { unreadCount: true },
        });
        await recordUniversalUnreadWebhook(tx, {
          serviceRequestId: request.id,
          externalUserId: request.createdByExternalContact.externalUserId,
          unreadCount: readState.unreadCount,
        });
      }
    }
  }
  const eventId = randomUUID();
  return enqueueDelivery(tx, {
    serviceRequestId: request.id,
    eventType,
    payload: {
      id: eventId,
      type: eventType,
      createdAt: new Date().toISOString(),
      data,
    },
  });
}

export async function recordUniversalUnreadWebhook(
  tx: Prisma.TransactionClient,
  input: {
    serviceRequestId: string;
    externalUserId: string;
    unreadCount: number;
  },
) {
  const request = await tx.serviceRequest.findUnique({
    where: { id: input.serviceRequestId },
    select: { id: true, number: true, title: true, status: true },
  });
  if (!request) return null;
  const eventType = "request.unread.changed" as const;
  const eventId = randomUUID();
  return enqueueDelivery(tx, {
    serviceRequestId: request.id,
    eventType,
    payload: {
      id: eventId,
      type: eventType,
      createdAt: new Date().toISOString(),
      data: {
        externalUserId: input.externalUserId,
        unreadCount: input.unreadCount,
        request: {
          id: request.id,
          number: request.number,
          title: request.title,
          status: request.status,
        },
      },
    },
  });
}

function errorMessage(error: unknown) {
  return error instanceof DomainError
    ? error.message.slice(0, 500)
    : error instanceof Error
      ? error.message.slice(0, 500)
      : "Webhook 投递失败";
}

export async function processUniversalWebhookDelivery(deliveryId: string) {
  const claimed = await withSystemDb(async (tx) => {
    await tx.$executeRaw`
      UPDATE "UniversalWebhookDelivery"
      SET
        status = 'FAILED',
        "nextAttemptAt" = NULL,
        "lastError" = 'Webhook 投递进程中断且已达到重试上限',
        "updatedAt" = CURRENT_TIMESTAMP
      WHERE id = ${deliveryId}
        AND status = 'PROCESSING'
        AND "lastAttemptAt" <= CURRENT_TIMESTAMP - make_interval(
          secs => ${UNIVERSAL_WEBHOOK_PROCESSING_STALE_MS / 1000}
        )
        AND "attemptCount" >= ${UNIVERSAL_WEBHOOK_MAX_ATTEMPTS}
    `;
    let [updated] = await tx.$queryRaw<Array<{ id: string }>>`
      UPDATE "UniversalWebhookDelivery"
      SET
        status = 'PROCESSING',
        "attemptCount" = "attemptCount" + 1,
        "lastAttemptAt" = CURRENT_TIMESTAMP,
        "nextAttemptAt" = NULL,
        "lastError" = NULL,
        "updatedAt" = CURRENT_TIMESTAMP
      WHERE id = ${deliveryId}
        AND (
          status = 'PENDING'
          OR (
            status = 'FAILED'
            AND "nextAttemptAt" IS NOT NULL
            AND "nextAttemptAt" <= CURRENT_TIMESTAMP
          )
        )
        AND "attemptCount" < ${UNIVERSAL_WEBHOOK_MAX_ATTEMPTS}
      RETURNING id
    `;
    if (!updated) {
      [updated] = await tx.$queryRaw<Array<{ id: string }>>`
        UPDATE "UniversalWebhookDelivery"
        SET
          "lastAttemptAt" = CURRENT_TIMESTAMP,
          "nextAttemptAt" = NULL,
          "lastError" = NULL,
          "updatedAt" = CURRENT_TIMESTAMP
        WHERE id = ${deliveryId}
          AND status = 'PROCESSING'
          AND "lastAttemptAt" <= CURRENT_TIMESTAMP - make_interval(
            secs => ${UNIVERSAL_WEBHOOK_PROCESSING_STALE_MS / 1000}
          )
          AND "attemptCount" < ${UNIVERSAL_WEBHOOK_MAX_ATTEMPTS}
        RETURNING id
      `;
    }
    if (!updated) return null;
    return tx.universalWebhookDelivery.findUnique({
      where: { id: deliveryId },
      include: {
        connection: {
          include: {
            binding: { include: { plugin: true } },
          },
        },
      },
    });
  });
  if (!claimed) return { queued: false, terminal: false };
  if (
    !claimed.connection.webhookUrl ||
    !claimed.connection.webhookSecretEncrypted ||
    !claimed.connection.binding.plugin.enabled ||
    claimed.connection.binding.plugin.healthStatus !== "READY" ||
    claimed.connection.binding.status === "ARCHIVED" ||
    (claimed.eventType !== "connector.test" &&
      claimed.connection.binding.status !== "ACTIVE")
  ) {
    await withSystemDb((tx) =>
      tx.universalWebhookDelivery.update({
        where: { id: claimed.id },
        data: {
          status: "FAILED",
          nextAttemptAt: null,
          lastError: "Webhook 配置已停用",
        },
      }),
    );
    return { queued: false, terminal: true };
  }
  try {
    const rawBody = JSON.stringify(claimed.payload);
    const result = await postUniversalWebhook({
      url: claimed.connection.webhookUrl,
      secret: decryptSecret(claimed.connection.webhookSecretEncrypted),
      eventId: claimed.eventId,
      rawBody,
    });
    await withSystemDb(async (tx) => {
      await tx.universalWebhookDelivery.update({
        where: { id: claimed.id },
        data: {
          status: "DELIVERED",
          responseStatus: result.status,
          deliveredAt: new Date(),
          nextAttemptAt: null,
          lastError: null,
        },
      });
      await tx.universalConnectorConnection.update({
        where: { bindingId: claimed.bindingId },
        data: { webhookStatus: "READY" },
      });
    });
    return { queued: false, terminal: true };
  } catch (error) {
    const details =
      error instanceof DomainError &&
      error.details &&
      typeof error.details === "object" &&
      !Array.isArray(error.details)
        ? (error.details as { responseStatus?: unknown })
        : null;
    const retryIndex = claimed.attemptCount - 1;
    const delay = UNIVERSAL_WEBHOOK_RETRY_DELAYS_MS[retryIndex];
    const terminal =
      claimed.attemptCount >= UNIVERSAL_WEBHOOK_MAX_ATTEMPTS ||
      delay === undefined;
    const nextAttemptAt = terminal ? null : new Date(Date.now() + delay);
    await withSystemDb(async (tx) => {
      await tx.universalWebhookDelivery.update({
        where: { id: claimed.id },
        data: {
          status: "FAILED",
          nextAttemptAt,
          responseStatus:
            typeof details?.responseStatus === "number"
              ? details.responseStatus
              : null,
          lastError: errorMessage(error),
        },
      });
      await tx.universalConnectorConnection.update({
        where: { bindingId: claimed.bindingId },
        data: { webhookStatus: "ERROR" },
      });
    });
    return { queued: !terminal, terminal, nextAttemptAt };
  }
}

export function listDueUniversalWebhookDeliveries(limit = 100) {
  return withSystemDb(async (tx) => {
    await tx.$executeRaw`
      UPDATE "UniversalWebhookDelivery"
      SET
        status = 'FAILED',
        "nextAttemptAt" = NULL,
        "lastError" = 'Webhook 投递进程中断且已达到重试上限',
        "updatedAt" = CURRENT_TIMESTAMP
      WHERE status = 'PROCESSING'
        AND "lastAttemptAt" <= CURRENT_TIMESTAMP - make_interval(
          secs => ${UNIVERSAL_WEBHOOK_PROCESSING_STALE_MS / 1000}
        )
        AND "attemptCount" >= ${UNIVERSAL_WEBHOOK_MAX_ATTEMPTS}
    `;
    return tx.$queryRaw<Array<{ id: string }>>`
      SELECT id
      FROM "UniversalWebhookDelivery"
      WHERE "attemptCount" < ${UNIVERSAL_WEBHOOK_MAX_ATTEMPTS}
        AND (
          (
            status = 'PENDING'
            OR (
              status = 'FAILED'
              AND "nextAttemptAt" IS NOT NULL
              AND "nextAttemptAt" <= CURRENT_TIMESTAMP
            )
          )
          OR (
            status = 'PROCESSING'
            AND "lastAttemptAt" <= CURRENT_TIMESTAMP - make_interval(
              secs => ${UNIVERSAL_WEBHOOK_PROCESSING_STALE_MS / 1000}
            )
          )
        )
      ORDER BY "createdAt" ASC
      LIMIT ${Math.min(Math.max(limit, 1), 500)}
    `;
  });
}
