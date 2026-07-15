-- Extend mail delivery modes and statuses.
ALTER TYPE "MailDeliveryMode" ADD VALUE IF NOT EXISTS 'RESEND';
ALTER TYPE "MailMessageStatus" ADD VALUE IF NOT EXISTS 'DELIVERY_DELAYED';
ALTER TYPE "MailMessageStatus" ADD VALUE IF NOT EXISTS 'DELIVERED';
ALTER TYPE "MailMessageStatus" ADD VALUE IF NOT EXISTS 'BOUNCED';
ALTER TYPE "MailMessageStatus" ADD VALUE IF NOT EXISTS 'COMPLAINED';
ALTER TYPE "MailMessageStatus" ADD VALUE IF NOT EXISTS 'SUPPRESSED';

-- Resend provider configuration. Provider secrets are encrypted by the app.
ALTER TABLE "PlatformSetting"
  ADD COLUMN "mailFrom" TEXT NOT NULL DEFAULT '服务支持中心 <no-reply@mail.achord.cn>',
  ADD COLUMN "mailReplyTo" TEXT NOT NULL DEFAULT 'support@achord.cn',
  ADD COLUMN "resendApiKeyEncrypted" TEXT,
  ADD COLUMN "resendDomain" TEXT NOT NULL DEFAULT 'mail.achord.cn',
  ADD COLUMN "resendDomainId" TEXT,
  ADD COLUMN "resendDomainStatus" TEXT,
  ADD COLUMN "resendDnsRecords" JSONB,
  ADD COLUMN "resendWebhookId" TEXT,
  ADD COLUMN "resendWebhookStatus" TEXT,
  ADD COLUMN "resendWebhookSecretEncrypted" TEXT,
  ADD COLUMN "resendLastCheckedAt" TIMESTAMP(3);

ALTER TABLE "MailMessage"
  ADD COLUMN "deliveryMode" "MailDeliveryMode" NOT NULL DEFAULT 'LOCAL_OUTBOX',
  ADD COLUMN "lastEventAt" TIMESTAMP(3);

UPDATE "MailMessage"
SET "deliveryMode" = CASE
  WHEN "providerId" = 'local-outbox' THEN 'LOCAL_OUTBOX'::"MailDeliveryMode"
  ELSE 'SMTP'::"MailDeliveryMode"
END
WHERE "providerId" IS NOT NULL;

CREATE INDEX "MailMessage_providerId_idx" ON "MailMessage"("providerId");

CREATE TABLE "MailProviderEvent" (
  "id" TEXT NOT NULL,
  "providerEventId" TEXT NOT NULL,
  "providerMessageId" TEXT,
  "eventType" TEXT NOT NULL,
  "detail" TEXT,
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "mailMessageId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MailProviderEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MailProviderEvent_providerEventId_key"
  ON "MailProviderEvent"("providerEventId");
CREATE INDEX "MailProviderEvent_providerMessageId_occurredAt_idx"
  ON "MailProviderEvent"("providerMessageId", "occurredAt");
CREATE INDEX "MailProviderEvent_mailMessageId_occurredAt_idx"
  ON "MailProviderEvent"("mailMessageId", "occurredAt");

ALTER TABLE "MailProviderEvent"
  ADD CONSTRAINT "MailProviderEvent_mailMessageId_fkey"
  FOREIGN KEY ("mailMessageId") REFERENCES "MailMessage"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "MailProviderEvent" ENABLE ROW LEVEL SECURITY;

CREATE POLICY mail_provider_event_admin_all ON "MailProviderEvent"
  FOR ALL
  USING (app_is_platform_admin())
  WITH CHECK (app_is_platform_admin());

GRANT SELECT, INSERT, UPDATE, DELETE ON "MailProviderEvent" TO service_platform_app;
