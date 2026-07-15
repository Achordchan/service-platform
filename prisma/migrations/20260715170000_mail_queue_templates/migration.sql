ALTER TABLE "MailMessage"
  ADD COLUMN "templateKey" TEXT,
  ADD COLUMN "previewText" TEXT,
  ADD COLUMN "attemptCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lastAttemptAt" TIMESTAMP(3);

ALTER TABLE "PlatformSetting"
  ADD COLUMN "smtpSecureConfigured" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "MailTemplateOverride" (
  "key" TEXT NOT NULL,
  "subject" TEXT NOT NULL,
  "previewText" TEXT NOT NULL,
  "heading" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "actionLabel" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "updatedById" TEXT,
  CONSTRAINT "MailTemplateOverride_pkey" PRIMARY KEY ("key")
);

CREATE INDEX "MailTemplateOverride_updatedAt_idx"
  ON "MailTemplateOverride"("updatedAt");

ALTER TABLE "MailTemplateOverride"
  ADD CONSTRAINT "MailTemplateOverride_updatedById_fkey"
  FOREIGN KEY ("updatedById") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "MailTemplateOverride" ENABLE ROW LEVEL SECURITY;

CREATE POLICY mail_template_override_admin_all ON "MailTemplateOverride"
  FOR ALL
  USING (app_is_platform_admin())
  WITH CHECK (app_is_platform_admin());

GRANT SELECT, INSERT, UPDATE, DELETE ON "MailTemplateOverride"
  TO service_platform_app;
