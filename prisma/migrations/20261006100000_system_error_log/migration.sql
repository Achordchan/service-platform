-- 系统报错日志：平台管理员在后台查看、筛选、导出，不必再登录服务器翻日志。
-- 只存脱敏后的结构化内容（见 src/lib/error-log.ts），写入走独立事务，不随业务事务回滚。

-- CreateTable
CREATE TABLE "SystemErrorLog" (
    "id" BIGSERIAL NOT NULL,
    "referenceId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "errorName" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "operation" TEXT,
    "requestMethod" TEXT,
    "requestPath" TEXT,
    "actorType" TEXT,
    "actorId" TEXT,
    "details" JSONB NOT NULL,
    "context" JSONB,
    "occurrenceCount" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SystemErrorLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SystemErrorLog_referenceId_key" ON "SystemErrorLog"("referenceId");

-- CreateIndex
CREATE INDEX "SystemErrorLog_createdAt_idx" ON "SystemErrorLog"("createdAt" DESC);

-- CreateIndex
CREATE INDEX "SystemErrorLog_category_createdAt_idx" ON "SystemErrorLog"("category", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "SystemErrorLog_source_createdAt_idx" ON "SystemErrorLog"("source", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "SystemErrorLog_operation_createdAt_idx" ON "SystemErrorLog"("operation", "createdAt" DESC);


-- RLS 迁移只对当时已存在的表发过 ALL TABLES 的 GRANT，新表和它的序列要自己补。
GRANT SELECT, INSERT, UPDATE, DELETE ON "SystemErrorLog" TO service_platform_app;
GRANT USAGE, SELECT ON SEQUENCE "SystemErrorLog_id_seq" TO service_platform_app;

-- 策略只有在显式 ENABLE ROW LEVEL SECURITY 后才会生效。
ALTER TABLE "SystemErrorLog" ENABLE ROW LEVEL SECURITY;

-- 读、写、改、删都只放行平台管理员：后台 worker 与 API 兜底写入走 withSystemDb
-- （app.is_platform_admin = true），普通员工和客户既读不到也写不进。
-- 分开写 SELECT / INSERT：INSERT ... RETURNING 会对返回行再评估 SELECT 策略，
-- 写入方是系统上下文，两条都满足，不会触发 Prisma create 的 RLS 拒绝。
CREATE POLICY system_error_log_select ON "SystemErrorLog"
  FOR SELECT USING (app_is_platform_admin());
CREATE POLICY system_error_log_insert ON "SystemErrorLog"
  FOR INSERT WITH CHECK (app_is_platform_admin());
-- 编号由业务决定的失败（mail_<邮件ID>）重复发生时 upsert 刷新同一行，需要 UPDATE 策略
CREATE POLICY system_error_log_update ON "SystemErrorLog"
  FOR UPDATE USING (app_is_platform_admin())
  WITH CHECK (app_is_platform_admin());
CREATE POLICY system_error_log_delete ON "SystemErrorLog"
  FOR DELETE USING (app_is_platform_admin());
