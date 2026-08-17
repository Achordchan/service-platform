CREATE TABLE "ProjectUpdateRevision" (
    "id" TEXT NOT NULL,
    "projectUpdateId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "visibility" "ContentVisibility" NOT NULL,
    "editedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "editedById" TEXT NOT NULL,

    CONSTRAINT "ProjectUpdateRevision_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "UpdateCommentRevision" (
    "id" TEXT NOT NULL,
    "updateCommentId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "visibility" "ContentVisibility" NOT NULL,
    "editedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "editedById" TEXT NOT NULL,

    CONSTRAINT "UpdateCommentRevision_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ProjectUpdateRevision_projectUpdateId_editedAt_idx"
  ON "ProjectUpdateRevision"("projectUpdateId", "editedAt");

CREATE INDEX "UpdateCommentRevision_updateCommentId_editedAt_idx"
  ON "UpdateCommentRevision"("updateCommentId", "editedAt");

ALTER TABLE "ProjectUpdateRevision"
  ADD CONSTRAINT "ProjectUpdateRevision_projectUpdateId_fkey"
  FOREIGN KEY ("projectUpdateId") REFERENCES "ProjectUpdate"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProjectUpdateRevision"
  ADD CONSTRAINT "ProjectUpdateRevision_editedById_fkey"
  FOREIGN KEY ("editedById") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "UpdateCommentRevision"
  ADD CONSTRAINT "UpdateCommentRevision_updateCommentId_fkey"
  FOREIGN KEY ("updateCommentId") REFERENCES "UpdateComment"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "UpdateCommentRevision"
  ADD CONSTRAINT "UpdateCommentRevision_editedById_fkey"
  FOREIGN KEY ("editedById") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ProjectUpdateRevision" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "UpdateCommentRevision" ENABLE ROW LEVEL SECURITY;

CREATE POLICY project_update_revision_staff_select
  ON "ProjectUpdateRevision"
  FOR SELECT
  USING (
    app_is_staff()
    AND EXISTS (
      SELECT 1
      FROM "ProjectUpdate" project_update
      WHERE project_update.id = "ProjectUpdateRevision"."projectUpdateId"
        AND app_can_access_project(project_update."projectId")
    )
  );

CREATE POLICY project_update_revision_staff_insert
  ON "ProjectUpdateRevision"
  FOR INSERT
  WITH CHECK (
    app_is_staff()
    AND "editedById" = app_user_id()
    AND EXISTS (
      SELECT 1
      FROM "ProjectUpdate" project_update
      WHERE project_update.id = "ProjectUpdateRevision"."projectUpdateId"
        AND app_can_access_project(project_update."projectId")
    )
  );

CREATE POLICY update_comment_revision_staff_select
  ON "UpdateCommentRevision"
  FOR SELECT
  USING (
    app_is_staff()
    AND EXISTS (
      SELECT 1
      FROM "UpdateComment" update_comment
      JOIN "ProjectUpdate" project_update
        ON project_update.id = update_comment."projectUpdateId"
      WHERE update_comment.id = "UpdateCommentRevision"."updateCommentId"
        AND app_can_access_project(project_update."projectId")
    )
  );

CREATE POLICY update_comment_revision_insert
  ON "UpdateCommentRevision"
  FOR INSERT
  WITH CHECK (
    "editedById" = app_user_id()
    AND EXISTS (
      SELECT 1
      FROM "UpdateComment" update_comment
      JOIN "ProjectUpdate" project_update
        ON project_update.id = update_comment."projectUpdateId"
      JOIN "Project" project
        ON project.id = project_update."projectId"
      WHERE update_comment.id = "UpdateCommentRevision"."updateCommentId"
        AND app_can_access_project(project_update."projectId")
        AND (
          app_is_staff()
          OR (
            update_comment."authorId" = app_user_id()
            AND update_comment.visibility = 'CUSTOMER_VISIBLE'
            AND project."customerUpdatesEnabled" = true
          )
        )
    )
  );

GRANT SELECT, INSERT ON "ProjectUpdateRevision" TO service_platform_app;
GRANT SELECT, INSERT ON "UpdateCommentRevision" TO service_platform_app;
