import "server-only";

import { Resend, type WebhookEventPayload } from "resend";
import { decryptSecret } from "@/lib/secret-crypto";
import { withSystemDb } from "@/lib/system-db";
import {
  resendEventToMessageStatus,
  shouldApplyMailEvent,
} from "@/modules/platform-settings/resend-event-state";
import { ensurePlatformSettings } from "@/modules/platform-settings/mail-settings-runtime";
import { DomainError } from "@/modules/projects/errors";

type ResendEmailEvent = Extract<
  WebhookEventPayload,
  { type: `email.${string}` }
>;

function eventDetail(event: ResendEmailEvent) {
  if (event.type === "email.failed") {
    return event.data.failed.reason;
  }
  if (event.type === "email.bounced") {
    return event.data.bounce.message;
  }
  if (event.type === "email.suppressed") {
    return event.data.suppressed.message;
  }
  if (event.type === "email.complained") {
    return "收件人已投诉该邮件";
  }
  if (event.type === "email.delivery_delayed") {
    return "邮件投递延迟，服务商仍在重试";
  }
  return null;
}

export async function verifyResendWebhook(input: {
  payload: string;
  id: string;
  timestamp: string;
  signature: string;
}) {
  const settings = await ensurePlatformSettings();
  if (!settings.resendWebhookSecretEncrypted) {
    throw new DomainError(
      "RESEND_WEBHOOK_NOT_CONFIGURED",
      "Resend Webhook 尚未配置",
      503,
    );
  }

  const resend = new Resend();
  return resend.webhooks.verify({
    payload: input.payload,
    headers: {
      id: input.id,
      timestamp: input.timestamp,
      signature: input.signature,
    },
    webhookSecret: decryptSecret(
      settings.resendWebhookSecretEncrypted,
    ),
  });
}

export async function recordResendWebhook(
  providerEventId: string,
  payload: WebhookEventPayload,
) {
  if (!payload.type.startsWith("email.")) {
    return { duplicate: false, ignored: true };
  }

  const event = payload as ResendEmailEvent;
  const status = resendEventToMessageStatus(event.type);
  if (!status) {
    return { duplicate: false, ignored: true };
  }

  const occurredAt = new Date(event.created_at);
  const safeOccurredAt = Number.isNaN(occurredAt.getTime())
    ? new Date()
    : occurredAt;

  try {
    return await withSystemDb(async (tx) => {
      await tx.$queryRaw`
        SELECT "id"
        FROM "MailMessage"
        WHERE "providerId" = ${event.data.email_id}
          AND "deliveryMode" = 'RESEND'::"MailDeliveryMode"
        LIMIT 1
        FOR UPDATE
      `;
      const message = await tx.mailMessage.findFirst({
        where: {
          providerId: event.data.email_id,
          deliveryMode: "RESEND",
        },
        select: {
          id: true,
          status: true,
          lastEventAt: true,
          sentAt: true,
        },
      });

      await tx.mailProviderEvent.create({
        data: {
          providerEventId,
          providerMessageId: event.data.email_id,
          eventType: event.type,
          detail: eventDetail(event),
          occurredAt: safeOccurredAt,
          mailMessageId: message?.id,
        },
      });

      if (!message) {
        return {
          duplicate: false,
          ignored: false,
          matched: false,
        };
      }
      if (
        !shouldApplyMailEvent({
          currentStatus: message.status,
          currentEventAt: message.lastEventAt,
          nextStatus: status,
          nextEventAt: safeOccurredAt,
        })
      ) {
        return { duplicate: false, ignored: true, matched: true };
      }

      const detail = eventDetail(event);
      await tx.mailMessage.update({
        where: { id: message.id },
        data: {
          status,
          errorMessage:
            status === "SENT" || status === "DELIVERED" ? null : detail,
          sentAt:
            message.sentAt ??
            (status === "SENT" || status === "DELIVERED"
              ? safeOccurredAt
              : undefined),
          lastEventAt: safeOccurredAt,
        },
      });
      return { duplicate: false, ignored: false, matched: true };
    });
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "P2002"
    ) {
      return { duplicate: true, ignored: false, matched: true };
    }
    throw error;
  }
}
