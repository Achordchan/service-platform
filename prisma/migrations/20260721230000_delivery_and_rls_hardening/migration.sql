CREATE OR REPLACE FUNCTION app_cancel_standard_request_mail_for_current_user(
  cancel_reason text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  target_user_id text := app_user_id();
BEGIN
  IF target_user_id IS NULL OR target_user_id = '' THEN
    RAISE EXCEPTION 'authenticated user context is required'
      USING ERRCODE = '42501';
  END IF;

  UPDATE "Notification"
  SET
    "emailDueAt" = NULL,
    "emailClaimedAt" = NULL
  WHERE "userId" = target_user_id
    AND "readAt" IS NULL;

  UPDATE "MailMessage" mail
  SET
    status = 'CANCELLED',
    "errorMessage" = cancel_reason,
    "updatedAt" = CURRENT_TIMESTAMP
  WHERE mail."sourceType" = 'STANDARD_REQUEST_NOTIFICATION'
    AND mail.status IN ('QUEUED', 'PROCESSING')
    AND EXISTS (
      SELECT 1
      FROM "Notification" notification
      WHERE notification.id = mail."notificationId"
        AND notification."userId" = target_user_id
    );
END;
$$;

REVOKE ALL ON FUNCTION app_cancel_standard_request_mail_for_current_user(text)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_cancel_standard_request_mail_for_current_user(text)
  TO service_platform_app;

CREATE OR REPLACE FUNCTION app_upsert_request_notification(
  notification_id text,
  notification_type text,
  notification_title text,
  notification_body text,
  recipient_user_id text,
  target_customer_space_id text,
  target_project_id text,
  target_service_request_id text,
  target_aggregation_key text,
  target_email_due_at timestamp without time zone
)
RETURNS TABLE(id text, occurrence_count integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT app_can_access_request(target_service_request_id)
    OR NOT app_user_relevant_to_project(
      recipient_user_id,
      target_project_id
    )
  THEN
    RAISE EXCEPTION 'request notification scope denied';
  END IF;

  RETURN QUERY
  INSERT INTO "Notification" (
    id,
    type,
    title,
    body,
    "readAt",
    "aggregationKey",
    "occurrenceCount",
    "emailDueAt",
    "emailClaimedAt",
    "userId",
    "customerSpaceId",
    "projectId",
    "serviceRequestId",
    "createdAt",
    "updatedAt"
  )
  VALUES (
    notification_id,
    notification_type::"NotificationType",
    notification_title,
    notification_body,
    NULL,
    target_aggregation_key,
    1,
    target_email_due_at,
    NULL,
    recipient_user_id,
    target_customer_space_id,
    target_project_id,
    target_service_request_id,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  )
  ON CONFLICT ("userId", "aggregationKey")
  DO UPDATE SET
    type = EXCLUDED.type,
    title = EXCLUDED.title,
    body = EXCLUDED.body,
    "readAt" = NULL,
    "occurrenceCount" = "Notification"."occurrenceCount" + 1,
    "emailDueAt" = EXCLUDED."emailDueAt",
    "emailClaimedAt" = NULL,
    "customerSpaceId" = EXCLUDED."customerSpaceId",
    "projectId" = EXCLUDED."projectId",
    "serviceRequestId" = EXCLUDED."serviceRequestId",
    "updatedAt" = CURRENT_TIMESTAMP
  RETURNING
    "Notification".id,
    "Notification"."occurrenceCount";
END;
$$;

GRANT EXECUTE ON FUNCTION app_upsert_request_notification(
  text, text, text, text, text, text, text, text, text, timestamp without time zone
) TO service_platform_app;

CREATE OR REPLACE FUNCTION app_can_access_request_fields(
  target_project_id text,
  target_assignee_id text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT app_is_platform_admin() OR EXISTS (
    SELECT 1
    FROM "Project" project
    WHERE project.id = target_project_id
      AND (
        (
          project."customerRequestsEnabled" = true
          AND EXISTS (
            SELECT 1
            FROM "Membership" membership
            WHERE membership."customerSpaceId" = project."customerSpaceId"
              AND membership."userId" = app_user_id()
          )
        )
        OR (
          target_assignee_id IS NOT NULL
          AND target_assignee_id = app_user_id()
        )
        OR EXISTS (
          SELECT 1
          FROM "ProjectStaff" staff
          WHERE staff."projectId" = project.id
            AND staff."userId" = app_user_id()
            AND staff.role = 'PROJECT_MANAGER'
        )
      )
  );
$$;

GRANT EXECUTE ON FUNCTION app_can_access_request_fields(text, text)
  TO service_platform_app;

DROP POLICY IF EXISTS service_request_insert ON "ServiceRequest";
CREATE POLICY service_request_insert ON "ServiceRequest"
  FOR INSERT WITH CHECK (
    (
      app_external_contact_id() IS NOT NULL
      AND "createdById" IS NULL
      AND "createdByExternalContactId" = app_external_contact_id()
      AND app_external_contact_can_access_project("projectId")
    )
    OR (
      app_external_contact_id() IS NULL
      AND app_can_access_project("projectId")
      AND (
        app_is_staff()
        OR EXISTS (
          SELECT 1
          FROM "Project" project
          WHERE project.id = "ServiceRequest"."projectId"
            AND project."customerRequestsEnabled" = true
        )
      )
    )
  );

CREATE OR REPLACE FUNCTION app_project_non_staff_update_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_user = 'service_platform_app' AND NOT app_is_staff() THEN
    RAISE EXCEPTION 'customers cannot modify project configuration'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS project_non_staff_update_guard ON "Project";
CREATE TRIGGER project_non_staff_update_guard
  BEFORE UPDATE ON "Project"
  FOR EACH ROW
  EXECUTE FUNCTION app_project_non_staff_update_guard();

CREATE OR REPLACE FUNCTION app_external_service_request_update_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF app_external_contact_id() IS NULL THEN
    IF current_user = 'service_platform_app'
       AND NOT app_is_staff()
       AND NEW."archivedAt" IS DISTINCT FROM OLD."archivedAt"
    THEN
      RAISE EXCEPTION 'customers cannot archive or restore service requests'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.number IS DISTINCT FROM OLD.number
     OR NEW.title IS DISTINCT FROM OLD.title
     OR NEW.description IS DISTINCT FROM OLD.description
     OR NEW.priority IS DISTINCT FROM OLD.priority
     OR NEW."projectId" IS DISTINCT FROM OLD."projectId"
     OR NEW."categoryId" IS DISTINCT FROM OLD."categoryId"
     OR NEW."createdById" IS DISTINCT FROM OLD."createdById"
     OR NEW."createdByExternalContactId" IS DISTINCT FROM OLD."createdByExternalContactId"
     OR NEW."assigneeId" IS DISTINCT FROM OLD."assigneeId"
     OR NEW."archivedAt" IS DISTINCT FROM OLD."archivedAt"
     OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
  THEN
    RAISE EXCEPTION 'external contact cannot modify protected service request fields'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

ALTER TABLE "Attachment"
  ADD CONSTRAINT "Attachment_milestone_parent_exclusive_check"
  CHECK (
    "milestoneId" IS NULL
    OR (
      inline = true
      AND "serviceRequestId" IS NULL
      AND "requestMessageId" IS NULL
      AND "projectUpdateId" IS NULL
      AND "updateCommentId" IS NULL
      AND "supportPlaybookKey" IS NULL
    )
  );

CREATE OR REPLACE FUNCTION app_attachment_milestone_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."milestoneId" IS NOT NULL THEN
    IF NEW."projectId" IS NULL OR NOT EXISTS (
      SELECT 1
      FROM "Milestone" milestone
      WHERE milestone.id = NEW."milestoneId"
        AND milestone."projectId" = NEW."projectId"
    ) THEN
      RAISE EXCEPTION 'milestone attachment must belong to the same project'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF current_user = 'service_platform_app'
     AND NOT app_is_staff()
     AND (
       (TG_OP = 'INSERT' AND NEW."milestoneId" IS NOT NULL)
       OR (
         TG_OP = 'UPDATE'
         AND NEW."milestoneId" IS DISTINCT FROM OLD."milestoneId"
       )
     )
  THEN
    RAISE EXCEPTION 'customers cannot change milestone attachment ownership'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS attachment_milestone_guard ON "Attachment";
CREATE TRIGGER attachment_milestone_guard
  BEFORE INSERT OR UPDATE ON "Attachment"
  FOR EACH ROW
  EXECUTE FUNCTION app_attachment_milestone_guard();

DROP POLICY IF EXISTS project_update_access ON "ProjectUpdate";
DROP POLICY IF EXISTS project_update_select ON "ProjectUpdate";
DROP POLICY IF EXISTS project_update_insert ON "ProjectUpdate";
DROP POLICY IF EXISTS project_update_update ON "ProjectUpdate";
DROP POLICY IF EXISTS project_update_delete ON "ProjectUpdate";

CREATE POLICY project_update_select ON "ProjectUpdate"
  FOR SELECT USING (
    app_can_access_project("projectId")
    AND (
      app_is_staff()
      OR (
        visibility = 'CUSTOMER_VISIBLE'
        AND EXISTS (
          SELECT 1
          FROM "Project" project
          WHERE project.id = "ProjectUpdate"."projectId"
            AND project."customerUpdatesEnabled" = true
        )
      )
    )
  );
CREATE POLICY project_update_insert ON "ProjectUpdate"
  FOR INSERT WITH CHECK (
    app_is_staff() AND app_can_access_project("projectId")
  );
CREATE POLICY project_update_update ON "ProjectUpdate"
  FOR UPDATE
  USING (app_is_staff() AND app_can_access_project("projectId"))
  WITH CHECK (app_is_staff() AND app_can_access_project("projectId"));
CREATE POLICY project_update_delete ON "ProjectUpdate"
  FOR DELETE USING (app_is_staff() AND app_can_access_project("projectId"));

DROP POLICY IF EXISTS update_comment_access ON "UpdateComment";
DROP POLICY IF EXISTS update_comment_select ON "UpdateComment";
DROP POLICY IF EXISTS update_comment_insert ON "UpdateComment";
DROP POLICY IF EXISTS update_comment_update ON "UpdateComment";
DROP POLICY IF EXISTS update_comment_delete ON "UpdateComment";

CREATE POLICY update_comment_select ON "UpdateComment"
  FOR SELECT USING (
    EXISTS (
      SELECT 1
      FROM "ProjectUpdate" project_update
      JOIN "Project" project ON project.id = project_update."projectId"
      WHERE project_update.id = "UpdateComment"."projectUpdateId"
        AND app_can_access_project(project_update."projectId")
        AND (
          app_is_staff()
          OR (
            "UpdateComment".visibility = 'CUSTOMER_VISIBLE'
            AND project."customerUpdatesEnabled" = true
          )
        )
    )
  );
CREATE POLICY update_comment_insert ON "UpdateComment"
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1
      FROM "ProjectUpdate" project_update
      JOIN "Project" project ON project.id = project_update."projectId"
      WHERE project_update.id = "UpdateComment"."projectUpdateId"
        AND app_can_access_project(project_update."projectId")
        AND (
          app_is_staff()
          OR (
            "UpdateComment".visibility = 'CUSTOMER_VISIBLE'
            AND project."customerUpdatesEnabled" = true
            AND "UpdateComment"."authorId" = app_user_id()
          )
        )
    )
  );
CREATE POLICY update_comment_update ON "UpdateComment"
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1
      FROM "ProjectUpdate" project_update
      JOIN "Project" project ON project.id = project_update."projectId"
      WHERE project_update.id = "UpdateComment"."projectUpdateId"
        AND app_can_access_project(project_update."projectId")
        AND (
          app_is_staff()
          OR (
            "UpdateComment"."authorId" = app_user_id()
            AND "UpdateComment".visibility = 'CUSTOMER_VISIBLE'
            AND project."customerUpdatesEnabled" = true
          )
        )
      )
    )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM "ProjectUpdate" project_update
      JOIN "Project" project ON project.id = project_update."projectId"
      WHERE project_update.id = "UpdateComment"."projectUpdateId"
        AND app_can_access_project(project_update."projectId")
        AND (
          app_is_staff()
          OR (
            "UpdateComment"."authorId" = app_user_id()
            AND "UpdateComment".visibility = 'CUSTOMER_VISIBLE'
            AND project."customerUpdatesEnabled" = true
          )
        )
      )
  );
CREATE POLICY update_comment_delete ON "UpdateComment"
  FOR DELETE USING (
    EXISTS (
      SELECT 1
      FROM "ProjectUpdate" project_update
      JOIN "Project" project ON project.id = project_update."projectId"
      WHERE project_update.id = "UpdateComment"."projectUpdateId"
        AND app_can_access_project(project_update."projectId")
        AND (
          app_is_staff()
          OR (
            "UpdateComment"."authorId" = app_user_id()
            AND project."customerUpdatesEnabled" = true
          )
        )
    )
  );

DROP POLICY IF EXISTS milestone_access ON "Milestone";
DROP POLICY IF EXISTS milestone_select ON "Milestone";
DROP POLICY IF EXISTS milestone_insert ON "Milestone";
DROP POLICY IF EXISTS milestone_update ON "Milestone";
DROP POLICY IF EXISTS milestone_delete ON "Milestone";

CREATE POLICY milestone_select ON "Milestone"
  FOR SELECT USING (
    app_can_access_project("projectId")
    AND (
      app_is_staff()
      OR EXISTS (
        SELECT 1
        FROM "Project" project
        WHERE project.id = "Milestone"."projectId"
          AND project."showMilestones" = true
      )
    )
  );
CREATE POLICY milestone_insert ON "Milestone"
  FOR INSERT WITH CHECK (
    app_is_staff() AND app_can_access_project("projectId")
  );
CREATE POLICY milestone_update ON "Milestone"
  FOR UPDATE
  USING (app_is_staff() AND app_can_access_project("projectId"))
  WITH CHECK (app_is_staff() AND app_can_access_project("projectId"));
CREATE POLICY milestone_delete ON "Milestone"
  FOR DELETE USING (app_is_staff() AND app_can_access_project("projectId"));

CREATE OR REPLACE FUNCTION app_project_milestone_progress(
  target_project_id text
)
RETURNS TABLE(
  total integer,
  not_started integer,
  in_progress integer,
  completed integer,
  percentage integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "Project" project
    WHERE project.id = target_project_id
      AND app_can_access_project(project.id)
      AND (app_is_staff() OR project."showProgress" = true)
  ) THEN
    RAISE EXCEPTION 'project progress scope denied'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    COUNT(*)::integer AS total,
    COUNT(*) FILTER (WHERE milestone.status = 'NOT_STARTED')::integer
      AS not_started,
    COUNT(*) FILTER (WHERE milestone.status = 'IN_PROGRESS')::integer
      AS in_progress,
    COUNT(*) FILTER (WHERE milestone.status = 'COMPLETED')::integer
      AS completed,
    CASE
      WHEN COUNT(*) = 0 THEN 0
      ELSE ROUND(
        COUNT(*) FILTER (WHERE milestone.status = 'COMPLETED')::numeric
        * 100
        / COUNT(*)
      )::integer
    END AS percentage
  FROM "Milestone" milestone
  WHERE milestone."projectId" = target_project_id;
END;
$$;

REVOKE ALL ON FUNCTION app_project_milestone_progress(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_project_milestone_progress(text)
  TO service_platform_app;

CREATE OR REPLACE FUNCTION app_project_attachment_feature_enabled(
  target_project_id text,
  target_project_update_id text,
  target_update_comment_id text,
  target_milestone_id text,
  target_inline boolean
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
        WHEN target_inline = true
          THEN project."customerRequestsEnabled"
        ELSE project."customerFilesEnabled"
      END
  );
$$;

GRANT EXECUTE ON FUNCTION app_project_attachment_feature_enabled(
  text, text, text, text, boolean
) TO service_platform_app;

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
          inline
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
          inline
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
            inline
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
            inline
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
          inline
        )
      )
    )
  );
