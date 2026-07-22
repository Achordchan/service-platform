ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'PROJECT_STAGE';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'PROJECT_MILESTONE';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'PROJECT_FILE';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'REQUEST_ATTACHMENT';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'REQUEST_ARCHIVE';

ALTER TABLE "User"
  ADD COLUMN "soundNotificationsEnabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "requestEmailNotificationsEnabled" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "PlatformSetting"
  ADD COLUMN "standardRequestEmailEnabled" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Notification"
  ADD COLUMN "emailDueAt" TIMESTAMP(3),
  ADD COLUMN "emailClaimedAt" TIMESTAMP(3),
  ADD COLUMN "emailLastSentOccurrenceCount" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "MailMessage"
  ADD COLUMN "sendAfter" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "idempotencyKey" TEXT,
  ADD COLUMN "notificationId" TEXT,
  ADD COLUMN "notificationOccurrenceCount" INTEGER,
  ADD COLUMN "sourceType" TEXT,
  ADD COLUMN "sourceId" TEXT;

CREATE INDEX "Notification_emailDueAt_readAt_idx"
  ON "Notification"("emailDueAt", "readAt");

CREATE UNIQUE INDEX "MailMessage_idempotencyKey_key"
  ON "MailMessage"("idempotencyKey");

CREATE INDEX "MailMessage_status_sendAfter_idx"
  ON "MailMessage"("status", "sendAfter");

CREATE INDEX "MailMessage_notificationId_notificationOccurrenceCount_idx"
  ON "MailMessage"("notificationId", "notificationOccurrenceCount");

CREATE INDEX "MailMessage_sourceType_sourceId_createdAt_idx"
  ON "MailMessage"("sourceType", "sourceId", "createdAt");

ALTER TABLE "MailMessage"
  ADD CONSTRAINT "MailMessage_notificationId_fkey"
  FOREIGN KEY ("notificationId") REFERENCES "Notification"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE POLICY mail_message_customer_invitation_insert ON "MailMessage"
  FOR INSERT
  WITH CHECK (
    "sourceType" = 'CUSTOMER_MEMBER_INVITATION'
    AND "sourceId" IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM "Invitation" invitation
      JOIN "Membership" membership
        ON membership."customerSpaceId" = invitation."customerSpaceId"
      WHERE invitation.id = "sourceId"
        AND lower(invitation.email) = lower("toEmail")
        AND membership."userId" = app_user_id()
        AND membership.role = 'OWNER'
    )
  );

CREATE OR REPLACE FUNCTION app_standard_request_email_enabled()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(
    (SELECT "standardRequestEmailEnabled" FROM "PlatformSetting" WHERE id = 1),
    false
  );
$$;

GRANT EXECUTE ON FUNCTION app_standard_request_email_enabled()
  TO service_platform_app;
