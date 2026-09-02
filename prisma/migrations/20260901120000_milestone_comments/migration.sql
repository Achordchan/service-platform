-- 里程碑评论：与动态评论同构（正文 + 可见性 + 作者），挂在里程碑上。
-- 前后台都能评论，编辑/删除沿用动态评论的口径：作者本人 + 服务层校验，
-- RLS 只兜可见性与项目边界。

ALTER TYPE "ContentRiskTargetType" ADD VALUE IF NOT EXISTS 'MILESTONE_COMMENT';

CREATE TABLE "MilestoneComment" (
    "id" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "visibility" "ContentVisibility" NOT NULL DEFAULT 'CUSTOMER_VISIBLE',
    "milestoneId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MilestoneComment_pkey" PRIMARY KEY ("id")
);

-- RLS 迁移只对当时已存在的表发过 ALL TABLES 的 GRANT，新表要自己补
GRANT SELECT, INSERT, UPDATE, DELETE ON "MilestoneComment" TO service_platform_app;

CREATE INDEX "MilestoneComment_milestoneId_createdAt_idx" ON "MilestoneComment"("milestoneId", "createdAt");

ALTER TABLE "MilestoneComment" ADD CONSTRAINT "MilestoneComment_milestoneId_fkey" FOREIGN KEY ("milestoneId") REFERENCES "Milestone"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MilestoneComment" ADD CONSTRAINT "MilestoneComment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 客户可见性同动态评论：里程碑模块开着（showMilestones/showProgress）才放行 CUSTOMER_VISIBLE。
CREATE POLICY milestone_comment_select ON "MilestoneComment"
  FOR SELECT USING (
    EXISTS (
      SELECT 1
      FROM "Milestone" milestone
      JOIN "Project" project ON project.id = milestone."projectId"
      WHERE milestone.id = "MilestoneComment"."milestoneId"
        AND app_can_access_project(milestone."projectId")
        AND (
          app_is_staff()
          OR (
            "MilestoneComment".visibility = 'CUSTOMER_VISIBLE'
            AND (project."showMilestones" = true OR project."showProgress" = true)
          )
        )
    )
  );
CREATE POLICY milestone_comment_insert ON "MilestoneComment"
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1
      FROM "Milestone" milestone
      JOIN "Project" project ON project.id = milestone."projectId"
      WHERE milestone.id = "MilestoneComment"."milestoneId"
        AND app_can_access_project(milestone."projectId")
        AND (
          app_is_staff()
          OR (
            "MilestoneComment".visibility = 'CUSTOMER_VISIBLE'
            AND (project."showMilestones" = true OR project."showProgress" = true)
            AND "MilestoneComment"."authorId" = app_user_id()
          )
        )
    )
  );
-- 编辑只留给作者本人（RLS 兜底；服务层同样只放行作者，管理员也不例外）
CREATE POLICY milestone_comment_update ON "MilestoneComment"
  FOR UPDATE
  USING (
    "MilestoneComment"."authorId" = app_user_id()
    AND EXISTS (
      SELECT 1
      FROM "Milestone" milestone
      JOIN "Project" project ON project.id = milestone."projectId"
      WHERE milestone.id = "MilestoneComment"."milestoneId"
        AND app_can_access_project(milestone."projectId")
        AND (
          app_is_staff()
          OR (
            "MilestoneComment".visibility = 'CUSTOMER_VISIBLE'
            AND (project."showMilestones" = true OR project."showProgress" = true)
          )
        )
    )
  )
  WITH CHECK (
    "MilestoneComment"."authorId" = app_user_id()
    AND EXISTS (
      SELECT 1
      FROM "Milestone" milestone
      JOIN "Project" project ON project.id = milestone."projectId"
      WHERE milestone.id = "MilestoneComment"."milestoneId"
        AND app_can_access_project(milestone."projectId")
        AND (
          app_is_staff()
          OR (
            "MilestoneComment".visibility = 'CUSTOMER_VISIBLE'
            AND (project."showMilestones" = true OR project."showProgress" = true)
          )
        )
    )
  );
-- 删除同动态评论：员工（服务层按发布权限裁决）或作者本人
CREATE POLICY milestone_comment_delete ON "MilestoneComment"
  FOR DELETE USING (
    EXISTS (
      SELECT 1
      FROM "Milestone" milestone
      JOIN "Project" project ON project.id = milestone."projectId"
      WHERE milestone.id = "MilestoneComment"."milestoneId"
        AND app_can_access_project(milestone."projectId")
        AND (
          app_is_staff()
          OR (
            "MilestoneComment"."authorId" = app_user_id()
            AND (project."showMilestones" = true OR project."showProgress" = true)
          )
        )
    )
  );

-- 附件挂在里程碑评论上：归属列与外键先行，附件的可见性裁决沿用
-- app_project_attachment_feature_enabled —— 它按「附件挂在谁身上」选模块开关，
-- 里程碑评论与里程碑同开关（showMilestones/showProgress）
ALTER TABLE "Attachment" ADD COLUMN IF NOT EXISTS "milestoneCommentId" TEXT;
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_milestoneCommentId_fkey" FOREIGN KEY ("milestoneCommentId") REFERENCES "MilestoneComment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "Attachment_milestoneCommentId_idx" ON "Attachment"("milestoneCommentId");

CREATE OR REPLACE FUNCTION app_project_attachment_feature_enabled(
  target_project_id text,
  target_project_update_id text,
  target_update_comment_id text,
  target_milestone_id text,
  target_inline boolean,
  target_milestone_comment_id text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT app_is_staff() OR EXISTS (
    SELECT 1
    FROM "Project" project
    WHERE project.id = target_project_id
      AND CASE
        WHEN target_project_update_id IS NOT NULL
          OR target_update_comment_id IS NOT NULL
          THEN project."customerUpdatesEnabled"
        WHEN target_milestone_id IS NOT NULL
          THEN project."showMilestones"
        WHEN target_milestone_comment_id IS NOT NULL
          THEN (project."showMilestones" OR project."showProgress")
        WHEN target_inline = true
          THEN project."customerRequestsEnabled"
        ELSE project."customerFilesEnabled"
      END
  );
$$;

GRANT EXECUTE ON FUNCTION app_project_attachment_feature_enabled(
  text, text, text, text, boolean, text
) TO service_platform_app;
