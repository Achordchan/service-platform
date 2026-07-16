ALTER TYPE "EventType" ADD VALUE IF NOT EXISTS 'PLUGIN_RUN_UPDATED';

CREATE TYPE "UserEmailChangeStatus" AS ENUM (
  'PENDING',
  'COMPLETING',
  'COMPLETED',
  'CANCELLED',
  'EXPIRED'
);

CREATE TYPE "PluginRunStatus" AS ENUM (
  'QUEUED',
  'RUNNING',
  'PAUSED',
  'COMPLETED',
  'FAILED',
  'CANCELLED'
);

CREATE TYPE "PluginResourceStatus" AS ENUM (
  'PROCESSING',
  'COMPLETED',
  'SKIPPED',
  'FAILED'
);

CREATE TABLE "UserEmailChange" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "oldEmail" TEXT NOT NULL,
  "newEmail" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "status" "UserEmailChangeStatus" NOT NULL DEFAULT 'PENDING',
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "lastSentAt" TIMESTAMP(3) NOT NULL,
  "completedAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  "requestedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "UserEmailChange_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UserEmailChange_tokenHash_key"
  ON "UserEmailChange"("tokenHash");
CREATE INDEX "UserEmailChange_userId_status_idx"
  ON "UserEmailChange"("userId", "status");
CREATE INDEX "UserEmailChange_newEmail_status_idx"
  ON "UserEmailChange"("newEmail", "status");
CREATE INDEX "UserEmailChange_expiresAt_status_idx"
  ON "UserEmailChange"("expiresAt", "status");
CREATE UNIQUE INDEX "UserEmailChange_pending_user_key"
  ON "UserEmailChange"("userId")
  WHERE "status" IN ('PENDING', 'COMPLETING');
CREATE UNIQUE INDEX "UserEmailChange_pending_email_key"
  ON "UserEmailChange"("newEmail")
  WHERE "status" IN ('PENDING', 'COMPLETING');

ALTER TABLE "UserEmailChange"
  ADD CONSTRAINT "UserEmailChange_userId_fkey"
  FOREIGN KEY ("userId")
  REFERENCES "User"("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;

ALTER TABLE "UserEmailChange"
  ADD CONSTRAINT "UserEmailChange_requestedById_fkey"
  FOREIGN KEY ("requestedById")
  REFERENCES "User"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;

CREATE TABLE "PluginInstallation" (
  "key" TEXT NOT NULL,
  "version" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "config" JSONB NOT NULL,
  "healthStatus" TEXT NOT NULL DEFAULT 'UNKNOWN',
  "lastCheckedAt" TIMESTAMP(3),
  "lastError" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "updatedById" TEXT,

  CONSTRAINT "PluginInstallation_pkey" PRIMARY KEY ("key")
);

ALTER TABLE "PluginInstallation"
  ADD CONSTRAINT "PluginInstallation_updatedById_fkey"
  FOREIGN KEY ("updatedById")
  REFERENCES "User"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;

CREATE TABLE "PluginRun" (
  "id" TEXT NOT NULL,
  "pluginKey" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "status" "PluginRunStatus" NOT NULL DEFAULT 'QUEUED',
  "totalCount" INTEGER NOT NULL DEFAULT 0,
  "processedCount" INTEGER NOT NULL DEFAULT 0,
  "successCount" INTEGER NOT NULL DEFAULT 0,
  "skippedCount" INTEGER NOT NULL DEFAULT 0,
  "failedCount" INTEGER NOT NULL DEFAULT 0,
  "sourceBytes" BIGINT NOT NULL DEFAULT 0,
  "outputBytes" BIGINT NOT NULL DEFAULT 0,
  "savedBytes" BIGINT NOT NULL DEFAULT 0,
  "cursor" TEXT,
  "lastError" TEXT,
  "requestedById" TEXT,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "PluginRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PluginRun_pluginKey_status_createdAt_idx"
  ON "PluginRun"("pluginKey", "status", "createdAt");

ALTER TABLE "PluginRun"
  ADD CONSTRAINT "PluginRun_pluginKey_fkey"
  FOREIGN KEY ("pluginKey")
  REFERENCES "PluginInstallation"("key")
  ON DELETE CASCADE
  ON UPDATE CASCADE;

ALTER TABLE "PluginRun"
  ADD CONSTRAINT "PluginRun_requestedById_fkey"
  FOREIGN KEY ("requestedById")
  REFERENCES "User"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;

CREATE TABLE "PluginResourceState" (
  "pluginKey" TEXT NOT NULL,
  "resourceType" TEXT NOT NULL,
  "resourceId" TEXT NOT NULL,
  "status" "PluginResourceStatus" NOT NULL,
  "inputFingerprint" TEXT NOT NULL,
  "metadata" JSONB,
  "lastError" TEXT,
  "processedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "PluginResourceState_pkey"
    PRIMARY KEY ("pluginKey", "resourceType", "resourceId")
);

CREATE INDEX "PluginResourceState_pluginKey_status_updatedAt_idx"
  ON "PluginResourceState"("pluginKey", "status", "updatedAt");

ALTER TABLE "PluginResourceState"
  ADD CONSTRAINT "PluginResourceState_pluginKey_fkey"
  FOREIGN KEY ("pluginKey")
  REFERENCES "PluginInstallation"("key")
  ON DELETE CASCADE
  ON UPDATE CASCADE;

ALTER TABLE "UserEmailChange" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PluginInstallation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PluginRun" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PluginResourceState" ENABLE ROW LEVEL SECURITY;

CREATE POLICY user_email_change_admin_access ON "UserEmailChange"
  USING (app_is_platform_admin())
  WITH CHECK (app_is_platform_admin());

CREATE POLICY plugin_installation_admin_access ON "PluginInstallation"
  USING (app_is_platform_admin())
  WITH CHECK (app_is_platform_admin());

CREATE POLICY plugin_run_admin_access ON "PluginRun"
  USING (app_is_platform_admin())
  WITH CHECK (app_is_platform_admin());

CREATE POLICY plugin_resource_state_admin_access ON "PluginResourceState"
  USING (app_is_platform_admin())
  WITH CHECK (app_is_platform_admin());

GRANT SELECT, INSERT, UPDATE, DELETE ON "UserEmailChange"
  TO service_platform_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "PluginInstallation"
  TO service_platform_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "PluginRun"
  TO service_platform_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "PluginResourceState"
  TO service_platform_app;
