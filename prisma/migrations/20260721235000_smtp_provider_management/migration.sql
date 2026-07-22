ALTER TABLE "PlatformSetting"
  ADD COLUMN "smtpPasswordEncrypted" TEXT,
  ADD COLUMN "smtpHealthStatus" TEXT,
  ADD COLUMN "smtpLastCheckedAt" TIMESTAMP(3),
  ADD COLUMN "smtpLastError" TEXT;

ALTER TABLE "PlatformSetting"
  ADD CONSTRAINT "PlatformSetting_smtpHealthStatus_check"
  CHECK (
    "smtpHealthStatus" IS NULL
    OR "smtpHealthStatus" IN ('unchecked', 'healthy', 'error')
  );

UPDATE "PlatformSetting"
SET "smtpHealthStatus" = 'unchecked'
WHERE "smtpHost" IS NOT NULL
   OR "smtpUser" IS NOT NULL
   OR "smtpPassword" IS NOT NULL;
