-- 用户反馈：客户/员工从 Web 与小程序提交，落库为唯一事实源；
-- GitHub issue 只是附带同步通道（未配置 token / 调用失败都不影响反馈保存）。
-- 提交人身份只存在库里供员工端查看，绝不写进公开仓库的 issue 正文。

-- CreateEnum
CREATE TYPE "FeedbackSource" AS ENUM ('WEB', 'MINIAPP');

-- CreateEnum
CREATE TYPE "FeedbackIssueStatus" AS ENUM ('PENDING', 'CREATED', 'FAILED', 'SKIPPED');

-- CreateTable
CREATE TABLE "Feedback" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "source" "FeedbackSource" NOT NULL,
    "appVersion" TEXT,
    "platformInfo" JSONB,
    "submitterId" TEXT NOT NULL,
    "clientMutationKey" TEXT,
    "issueStatus" "FeedbackIssueStatus" NOT NULL DEFAULT 'PENDING',
    "issueNumber" INTEGER,
    "issueUrl" TEXT,
    "issueError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Feedback_pkey" PRIMARY KEY ("id")
);

-- RLS 迁移只对当时已存在的表发过 ALL TABLES 的 GRANT，新表要自己补；
-- 策略只有在显式 ENABLE ROW LEVEL SECURITY 后才会生效。
GRANT SELECT, INSERT, UPDATE, DELETE ON "Feedback" TO service_platform_app;
ALTER TABLE "Feedback" ENABLE ROW LEVEL SECURITY;

-- 反馈内容（含提交人身份）仅员工可见；客户与员工都能提交，
-- 但只能插入自己的行。issue 同步字段（issueStatus/issueNumber/issueUrl/
-- issueError）由系统身份回写（withSystemDb），提交人本人没有 UPDATE 权，
-- 防止绕过服务层篡改同步结果。
-- SELECT 策略必须放行提交人本人：INSERT ... RETURNING（Prisma create 默认带）
-- 在 PG 里会对返回行再评估 SELECT 策略，只允许员工时客户提交会被
-- 「new row violates row-level security policy」拒绝。服务层 listFeedback
-- 的 assertAllowed(isStaff) 仍把列表 API 限员工，客户拿不到列表。
-- 员工判断这里直读 GUC 而不调 app_is_staff()：该函数定义在
-- 20260713171000_visibility_rls（migrate deploy 按时间戳先于本迁移执行，
-- 全新库重放已验证），但直读让策略不依赖跨迁移的函数定义、自包含；
-- 表达式即该函数体本身，语义完全一致。
CREATE POLICY feedback_select ON "Feedback"
  FOR SELECT USING (
    COALESCE(current_setting('app.is_staff', true), 'false') = 'true'
    OR (app_user_id() IS NOT NULL AND "submitterId" = app_user_id())
  );
CREATE POLICY feedback_insert ON "Feedback"
  FOR INSERT WITH CHECK (
    app_user_id() IS NOT NULL AND "submitterId" = app_user_id()
  );
CREATE POLICY feedback_update ON "Feedback"
  FOR UPDATE USING (app_is_platform_admin())
  WITH CHECK (app_is_platform_admin());
CREATE POLICY feedback_delete ON "Feedback"
  FOR DELETE USING (app_is_platform_admin());

-- 弱网重试防重：同一提交人在拿到明确结果前复用同一 key，重试返回已建的反馈
-- 而不是再建一条（再建一个公开 GitHub issue）。
CREATE UNIQUE INDEX "Feedback_submitterId_clientMutationKey_key"
  ON "Feedback"("submitterId", "clientMutationKey");

-- CreateIndex
CREATE INDEX "Feedback_createdAt_idx" ON "Feedback"("createdAt" DESC);

-- CreateIndex
CREATE INDEX "Feedback_issueStatus_idx" ON "Feedback"("issueStatus");

-- CreateIndex
CREATE INDEX "Feedback_submitterId_createdAt_idx" ON "Feedback"("submitterId", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "Feedback" ADD CONSTRAINT "Feedback_submitterId_fkey" FOREIGN KEY ("submitterId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
