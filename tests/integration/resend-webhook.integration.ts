import { afterEach, describe, expect, it } from "vitest";
import type { WebhookEventPayload } from "resend";
import { withSystemDb } from "../../src/lib/system-db";
import {
  reconcileStoredResendEvents,
  recordResendWebhook,
} from "../../src/modules/platform-settings/resend-webhook-service";

const messageIds: string[] = [];
const providerIds: string[] = [];

afterEach(async () => {
  await withSystemDb(async (tx) => {
    await tx.mailProviderEvent.deleteMany({
      where: {
        OR: [
          { mailMessageId: { in: messageIds } },
          { providerMessageId: { in: providerIds } },
        ],
      },
    });
    await tx.mailMessage.deleteMany({ where: { id: { in: messageIds } } });
  });
  messageIds.length = 0;
  providerIds.length = 0;
});

describe("Resend webhook persistence", () => {
  it("deduplicates events and ignores out-of-order status changes", async () => {
    const providerId = `email-${crypto.randomUUID()}`;
    providerIds.push(providerId);
    const message = await withSystemDb((tx) =>
      tx.mailMessage.create({
        data: {
          toEmail: "recipient@example.com",
          subject: "Webhook test",
          heading: "Webhook test",
          body: "Webhook test",
          deliveryMode: "RESEND",
          status: "SENT",
          providerId,
          sentAt: new Date("2026-07-15T10:00:00Z"),
          lastEventAt: new Date("2026-07-15T10:00:00Z"),
        },
      }),
    );
    messageIds.push(message.id);

    const delivered = {
      type: "email.delivered",
      created_at: "2026-07-15T10:02:00Z",
      data: {
        created_at: "2026-07-15T10:00:00Z",
        email_id: providerId,
        from: "no-reply@mail.achord.cn",
        to: ["recipient@example.com"],
        subject: "Webhook test",
      },
    } satisfies WebhookEventPayload;
    const deliveredEventId = `event-${crypto.randomUUID()}`;

    const first = await recordResendWebhook(deliveredEventId, delivered);
    const duplicate = await recordResendWebhook(deliveredEventId, delivered);
    await recordResendWebhook(`event-${crypto.randomUUID()}`, {
      ...delivered,
      type: "email.sent",
      created_at: "2026-07-15T10:01:00Z",
    });

    const saved = await withSystemDb((tx) =>
      tx.mailMessage.findUniqueOrThrow({ where: { id: message.id } }),
    );
    const eventCount = await withSystemDb((tx) =>
      tx.mailProviderEvent.count({ where: { mailMessageId: message.id } }),
    );

    expect(first).toMatchObject({ duplicate: false, matched: true });
    expect(duplicate).toMatchObject({ duplicate: true });
    expect(saved.status).toBe("DELIVERED");
    expect(eventCount).toBe(2);
  });

  it("reconciles a webhook that arrives before the provider id is saved", async () => {
    const providerId = `email-${crypto.randomUUID()}`;
    providerIds.push(providerId);
    await recordResendWebhook(`event-${crypto.randomUUID()}`, {
      type: "email.delivered",
      created_at: "2026-07-15T10:02:00Z",
      data: {
        created_at: "2026-07-15T10:00:00Z",
        email_id: providerId,
        from: "no-reply@mail.achord.cn",
        to: ["recipient@example.com"],
        subject: "Webhook race test",
      },
    } satisfies WebhookEventPayload);

    const message = await withSystemDb((tx) =>
      tx.mailMessage.create({
        data: {
          toEmail: "recipient@example.com",
          subject: "Webhook race test",
          heading: "Webhook race test",
          body: "Webhook race test",
          deliveryMode: "RESEND",
          status: "SENT",
          providerId,
          sentAt: new Date("2026-07-15T10:03:00Z"),
        },
      }),
    );
    messageIds.push(message.id);

    await reconcileStoredResendEvents(providerId, message.id);

    const saved = await withSystemDb((tx) =>
      tx.mailMessage.findUniqueOrThrow({ where: { id: message.id } }),
    );
    const event = await withSystemDb((tx) =>
      tx.mailProviderEvent.findFirstOrThrow({
        where: { providerMessageId: providerId },
      }),
    );
    expect(saved.status).toBe("DELIVERED");
    expect(event.mailMessageId).toBe(message.id);
  });
});
