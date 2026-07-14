-- CreateEnum
CREATE TYPE "MailDeliveryMode" AS ENUM ('LOCAL_OUTBOX', 'SMTP');

-- CreateEnum
CREATE TYPE "MailMessageStatus" AS ENUM ('QUEUED', 'SENT', 'FAILED');

-- CreateTable
CREATE TABLE "PlatformSetting" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "appUrl" TEXT,
    "smtpHost" TEXT,
    "smtpPort" INTEGER,
    "smtpUser" TEXT,
    "smtpPassword" TEXT,
    "smtpFrom" TEXT,
    "smtpSecure" BOOLEAN NOT NULL DEFAULT false,
    "mailMode" "MailDeliveryMode" NOT NULL DEFAULT 'LOCAL_OUTBOX',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "PlatformSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MailMessage" (
    "id" TEXT NOT NULL,
    "toEmail" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "heading" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "actionLabel" TEXT,
    "actionUrl" TEXT,
    "status" "MailMessageStatus" NOT NULL DEFAULT 'QUEUED',
    "errorMessage" TEXT,
    "providerId" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MailMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MailMessage_status_createdAt_idx" ON "MailMessage"("status", "createdAt");

-- CreateIndex
CREATE INDEX "MailMessage_toEmail_createdAt_idx" ON "MailMessage"("toEmail", "createdAt");

-- AddForeignKey
ALTER TABLE "PlatformSetting" ADD CONSTRAINT "PlatformSetting_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Seed default platform settings for local development
INSERT INTO "PlatformSetting" ("id", "mailMode", "smtpFrom", "updatedAt")
VALUES (1, 'LOCAL_OUTBOX', '服务支持中心 <info@achord.cn>', CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

-- RLS: platform settings and mail outbox are admin-only operational data.
ALTER TABLE "PlatformSetting" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MailMessage" ENABLE ROW LEVEL SECURITY;

CREATE POLICY platform_setting_admin_all ON "PlatformSetting"
  FOR ALL
  USING (app_is_platform_admin())
  WITH CHECK (app_is_platform_admin());

CREATE POLICY mail_message_admin_all ON "MailMessage"
  FOR ALL
  USING (app_is_platform_admin())
  WITH CHECK (app_is_platform_admin());

GRANT SELECT, INSERT, UPDATE, DELETE ON "PlatformSetting" TO service_platform_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "MailMessage" TO service_platform_app;
