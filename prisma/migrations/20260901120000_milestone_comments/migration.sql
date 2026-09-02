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

-- RLS 迁移只对当时已存在的表发过 ALL TABLES 的 GRANT，新表要自己补；
-- 策略只有在显式 ENABLE ROW LEVEL SECURITY 后才会生效。
GRANT SELECT, INSERT, UPDATE, DELETE ON "MilestoneComment" TO service_platform_app;
ALTER TABLE "MilestoneComment" ENABLE ROW LEVEL SECURITY;

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
-- 常规编辑只留给作者本人。唯一绕行是平台管理员/系统执行的
-- 内容风控快照恢复：它必须在同一事务显式设置专用 GUC。服务层的
-- 用户编辑仍严格限定作者本人，不因 RLS 风控通道而放宽。
CREATE POLICY milestone_comment_update ON "MilestoneComment"
  FOR UPDATE
  USING (
    (
      "MilestoneComment"."authorId" = app_user_id()
      OR (
        app_is_platform_admin()
        AND COALESCE(
          current_setting('app.content_risk_snapshot_write', true),
          'false'
        ) = 'true'
      )
    )
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
    (
      "MilestoneComment"."authorId" = app_user_id()
      OR (
        app_is_platform_admin()
        AND COALESCE(
          current_setting('app.content_risk_snapshot_write', true),
          'false'
        ) = 'true'
      )
    )
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

-- 附件的模块开关函数补一个六参重载（多出的里程碑评论归属列）。
-- 升级动作放在本迁移而不是回改旧迁移：旧迁移执行时本表和枚举值还不存在。
-- 旧五参版本被既有 attachment_* 策略引用，保留原样（重载并存无害）；
-- 下方再把四条策略重建为六参调用，让已部署库也切到新归属裁决。
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
        -- 里程碑评论附件同时带 milestoneId / milestoneCommentId：先判更具体的
        -- 评论归属，否则 progress-only 项目会被前面的 showMilestones=false 拦掉。
        -- 客户除了要通过模块开关，父评论也必须客户可见，且评论/里程碑
        -- 都未被撤回；附件自身是 CUSTOMER_VISIBLE 不能绕过父内容边界。
        WHEN target_milestone_comment_id IS NOT NULL
          THEN (
            (project."showMilestones" OR project."showProgress")
            AND EXISTS (
              SELECT 1
              FROM "MilestoneComment" comment
              JOIN "Milestone" milestone ON milestone.id = comment."milestoneId"
              WHERE comment.id = target_milestone_comment_id
                AND milestone."projectId" = project.id
                AND comment.visibility = 'CUSTOMER_VISIBLE'
                AND NOT EXISTS (
                  SELECT 1
                  FROM "ContentRiskState" risk
                  WHERE risk."targetType" = 'MILESTONE_COMMENT'
                    AND risk."targetId" = comment.id
                    AND risk."displayState" = 'REVOKED'
                )
                AND NOT EXISTS (
                  SELECT 1
                  FROM "ContentRiskState" risk
                  WHERE risk."targetType" = 'MILESTONE'
                    AND risk."targetId" = milestone.id
                    AND risk."displayState" = 'REVOKED'
                )
            )
          )
        WHEN target_milestone_id IS NOT NULL
          THEN project."showMilestones"
        WHEN target_inline = true
          THEN project."customerRequestsEnabled"
        ELSE project."customerFilesEnabled"
      END
  );
$$;

GRANT EXECUTE ON FUNCTION app_project_attachment_feature_enabled(
  text, text, text, text, boolean, text
) TO service_platform_app;


-- 已部署库不会重跑旧迁移：在本迁移重建四条 attachment 策略，显式传入
-- milestoneCommentId。这样里程碑评论附件按 progress/milestones 模块开关裁决，
-- 而不是继续停在旧五参函数的里程碑归属分支。
DROP POLICY IF EXISTS attachment_select ON "Attachment";
CREATE POLICY attachment_select ON "Attachment"
  FOR SELECT USING (
    (app_is_staff() OR visibility = 'CUSTOMER_VISIBLE')
    AND (
      app_is_platform_admin()
      OR (
        "serviceRequestId" IS NOT NULL
        AND app_can_access_request("serviceRequestId")
      )
      OR (
        "serviceRequestId" IS NULL
        AND "projectId" IS NOT NULL
        AND app_can_access_project("projectId")
        AND app_project_attachment_feature_enabled(
          "projectId",
          "projectUpdateId",
          "updateCommentId",
          "milestoneId",
          inline,
          "milestoneCommentId"
        )
      )
      OR (
        "supportPlaybookKey" IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM "RequestMessage" message
          WHERE message."supportPlaybookKey" = "Attachment"."supportPlaybookKey"
            AND message.visibility = 'CUSTOMER_VISIBLE'
            AND app_can_access_request(message."serviceRequestId")
        )
      )
    )
  );

DROP POLICY IF EXISTS attachment_insert ON "Attachment";
CREATE POLICY attachment_insert ON "Attachment"
  FOR INSERT WITH CHECK (
    (app_is_staff() OR visibility = 'CUSTOMER_VISIBLE')
    AND (
      app_is_platform_admin()
      OR (
        "serviceRequestId" IS NOT NULL
        AND app_can_access_request("serviceRequestId")
      )
      OR (
        "serviceRequestId" IS NULL
        AND "projectId" IS NOT NULL
        AND app_can_access_project("projectId")
        AND app_project_attachment_feature_enabled(
          "projectId",
          "projectUpdateId",
          "updateCommentId",
          "milestoneId",
          inline,
          "milestoneCommentId"
        )
      )
    )
    AND (
      app_external_contact_id() IS NULL
      OR (
        "uploadedById" IS NULL
        AND "uploadedByExternalContactId" = app_external_contact_id()
        AND visibility = 'CUSTOMER_VISIBLE'
      )
    )
  );

DROP POLICY IF EXISTS attachment_update ON "Attachment";
CREATE POLICY attachment_update ON "Attachment"
  FOR UPDATE
  USING (
    (
      app_external_contact_id() IS NULL
      AND (
        app_is_platform_admin()
        OR (
          "serviceRequestId" IS NOT NULL
          AND app_can_access_request("serviceRequestId")
        )
        OR (
          "serviceRequestId" IS NULL
          AND "projectId" IS NOT NULL
          AND app_can_access_project("projectId")
          AND app_project_attachment_feature_enabled(
            "projectId",
            "projectUpdateId",
            "updateCommentId",
            "milestoneId",
            inline,
            "milestoneCommentId"
          )
        )
      )
    )
    OR (
      app_external_contact_id() IS NOT NULL
      AND inline = true
      AND "uploadedByExternalContactId" = app_external_contact_id()
      AND "requestMessageId" IS NULL
      AND "serviceRequestId" IS NOT NULL
      AND app_can_access_request("serviceRequestId")
    )
  )
  WITH CHECK (
    (
      app_external_contact_id() IS NULL
      AND (
        app_is_platform_admin()
        OR (
          "serviceRequestId" IS NOT NULL
          AND app_can_access_request("serviceRequestId")
        )
        OR (
          "serviceRequestId" IS NULL
          AND "projectId" IS NOT NULL
          AND app_can_access_project("projectId")
          AND app_project_attachment_feature_enabled(
            "projectId",
            "projectUpdateId",
            "updateCommentId",
            "milestoneId",
            inline,
            "milestoneCommentId"
          )
        )
      )
    )
    OR (
      app_external_contact_id() IS NOT NULL
      AND inline = true
      AND "uploadedByExternalContactId" = app_external_contact_id()
      AND "requestMessageId" IS NOT NULL
      AND "serviceRequestId" IS NOT NULL
      AND app_can_access_request("serviceRequestId")
    )
  );

DROP POLICY IF EXISTS attachment_delete ON "Attachment";
CREATE POLICY attachment_delete ON "Attachment"
  FOR DELETE USING (
    app_external_contact_id() IS NULL
    AND (
      app_is_platform_admin()
      OR (
        "serviceRequestId" IS NOT NULL
        AND app_can_access_request("serviceRequestId")
      )
      OR (
        "serviceRequestId" IS NULL
        AND "projectId" IS NOT NULL
        AND app_can_access_project("projectId")
        AND app_project_attachment_feature_enabled(
          "projectId",
          "projectUpdateId",
          "updateCommentId",
          "milestoneId",
          inline,
          "milestoneCommentId"
        )
      )
    )
  );

-- 内容风控的目标可见性函数补上里程碑评论分支（枚举值在文件头已 ADD）。
-- 风控记录的插入策略按它裁决「作者是否够得着这个目标」。
CREATE OR REPLACE FUNCTION app_can_access_content_risk_target(
  target_type TEXT,
  target_id TEXT
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT app_is_platform_admin() OR CASE target_type
    WHEN 'SERVICE_REQUEST' THEN EXISTS (
      SELECT 1
      FROM "ServiceRequest" request
      WHERE request.id = target_id
        AND (
          app_can_access_request(request.id)
          OR (
            app_external_contact_id() IS NOT NULL
            AND request."createdByExternalContactId" = app_external_contact_id()
            AND app_external_contact_can_access_project(request."projectId")
          )
        )
    )
    WHEN 'REQUEST_MESSAGE' THEN EXISTS (
      SELECT 1
      FROM "RequestMessage" message
      JOIN "ServiceRequest" request ON request.id = message."serviceRequestId"
      WHERE message.id = target_id
        AND (
          app_can_access_request(request.id)
          OR (
            app_external_contact_id() IS NOT NULL
            AND request."createdByExternalContactId" = app_external_contact_id()
            AND app_external_contact_can_access_project(request."projectId")
          )
        )
    )
    WHEN 'PROJECT_UPDATE' THEN EXISTS (
      SELECT 1 FROM "ProjectUpdate" item
      WHERE item.id = target_id AND app_can_access_project(item."projectId")
    )
    WHEN 'UPDATE_COMMENT' THEN EXISTS (
      SELECT 1
      FROM "UpdateComment" comment
      JOIN "ProjectUpdate" item ON item.id = comment."projectUpdateId"
      WHERE comment.id = target_id AND app_can_access_project(item."projectId")
    )
    WHEN 'MILESTONE_COMMENT' THEN EXISTS (
      SELECT 1
      FROM "MilestoneComment" comment
      JOIN "Milestone" item ON item.id = comment."milestoneId"
      WHERE comment.id = target_id AND app_can_access_project(item."projectId")
    )
    WHEN 'MILESTONE' THEN EXISTS (
      SELECT 1 FROM "Milestone" item
      WHERE item.id = target_id AND app_can_access_project(item."projectId")
    )
    WHEN 'ATTACHMENT' THEN EXISTS (
      SELECT 1
      FROM "Attachment" attachment
      LEFT JOIN "RequestMessage" message ON message.id = attachment."requestMessageId"
      LEFT JOIN "ServiceRequest" request ON request.id = COALESCE(
        attachment."serviceRequestId",
        message."serviceRequestId"
      )
      LEFT JOIN "ProjectUpdate" project_update ON project_update.id = attachment."projectUpdateId"
      LEFT JOIN "UpdateComment" update_comment ON update_comment.id = attachment."updateCommentId"
      LEFT JOIN "ProjectUpdate" comment_update ON comment_update.id = update_comment."projectUpdateId"
      LEFT JOIN "Milestone" milestone ON milestone.id = attachment."milestoneId"
      LEFT JOIN "MilestoneComment" milestone_comment
        ON milestone_comment.id = attachment."milestoneCommentId"
      LEFT JOIN "Milestone" comment_milestone
        ON comment_milestone.id = milestone_comment."milestoneId"
      WHERE attachment.id = target_id
        AND (
          (
            request.id IS NOT NULL
            AND (
              app_can_access_request(request.id)
              OR (
                app_external_contact_id() IS NOT NULL
                AND request."createdByExternalContactId" = app_external_contact_id()
                AND app_external_contact_can_access_project(request."projectId")
              )
            )
          )
          OR (project_update.id IS NOT NULL AND app_can_access_project(project_update."projectId"))
          OR (comment_update.id IS NOT NULL AND app_can_access_project(comment_update."projectId"))
          OR (milestone.id IS NOT NULL AND app_can_access_project(milestone."projectId"))
          OR (comment_milestone.id IS NOT NULL AND app_can_access_project(comment_milestone."projectId"))
        )
    )
    ELSE FALSE
  END;
$$;

REVOKE ALL ON FUNCTION app_can_access_content_risk_target(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_can_access_content_risk_target(TEXT, TEXT)
  TO service_platform_app;
