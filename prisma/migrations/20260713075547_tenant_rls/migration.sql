-- This is an empty migration.
CREATE OR REPLACE FUNCTION app_user_id()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('app.user_id', true), '');
$$;

CREATE OR REPLACE FUNCTION app_is_platform_admin()
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(current_setting('app.is_platform_admin', true), 'false') = 'true';
$$;

CREATE OR REPLACE FUNCTION app_space_ids()
RETURNS text[]
LANGUAGE sql
STABLE
AS $$
  SELECT CASE
    WHEN NULLIF(current_setting('app.customer_space_ids', true), '') IS NULL THEN ARRAY[]::text[]
    ELSE string_to_array(current_setting('app.customer_space_ids', true), ',')
  END;
$$;

CREATE OR REPLACE FUNCTION app_can_access_space(target_space_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT app_is_platform_admin()
    OR target_space_id = ANY(app_space_ids())
    OR EXISTS (
      SELECT 1
      FROM "Membership" membership
      WHERE membership."customerSpaceId" = target_space_id
        AND membership."userId" = app_user_id()
    );
$$;

CREATE OR REPLACE FUNCTION app_can_access_project(target_project_id text)
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
        app_can_access_space(project."customerSpaceId")
        OR EXISTS (
          SELECT 1
          FROM "ProjectStaff" staff
          WHERE staff."projectId" = project.id
            AND staff."userId" = app_user_id()
        )
      )
  );
$$;

CREATE OR REPLACE FUNCTION app_can_access_request(target_request_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT app_is_platform_admin() OR EXISTS (
    SELECT 1
    FROM "ServiceRequest" request
    JOIN "Project" project ON project.id = request."projectId"
    WHERE request.id = target_request_id
      AND (
        app_can_access_space(project."customerSpaceId")
        OR request."assigneeId" = app_user_id()
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

GRANT EXECUTE ON FUNCTION app_user_id() TO service_platform_app;
GRANT EXECUTE ON FUNCTION app_is_platform_admin() TO service_platform_app;
GRANT EXECUTE ON FUNCTION app_space_ids() TO service_platform_app;
GRANT EXECUTE ON FUNCTION app_can_access_space(text) TO service_platform_app;
GRANT EXECUTE ON FUNCTION app_can_access_project(text) TO service_platform_app;
GRANT EXECUTE ON FUNCTION app_can_access_request(text) TO service_platform_app;

ALTER TABLE "CustomerSpace" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Membership" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Invitation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Project" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProjectStaff" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Milestone" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProjectUpdate" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "UpdateComment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ServiceRequest" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RequestMessage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Attachment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Notification" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "EventRecord" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AuditLog" ENABLE ROW LEVEL SECURITY;

CREATE POLICY customer_space_access ON "CustomerSpace"
  USING (app_can_access_space(id))
  WITH CHECK (app_can_access_space(id));

CREATE POLICY membership_access ON "Membership"
  USING (app_can_access_space("customerSpaceId"))
  WITH CHECK (app_can_access_space("customerSpaceId"));

CREATE POLICY invitation_access ON "Invitation"
  USING (app_can_access_space("customerSpaceId"))
  WITH CHECK (app_can_access_space("customerSpaceId"));

CREATE POLICY project_access ON "Project"
  USING (app_can_access_project(id))
  WITH CHECK (app_can_access_space("customerSpaceId") OR app_is_platform_admin());

CREATE POLICY project_staff_access ON "ProjectStaff"
  USING (app_can_access_project("projectId"))
  WITH CHECK (app_can_access_project("projectId"));

CREATE POLICY milestone_access ON "Milestone"
  USING (app_can_access_project("projectId"))
  WITH CHECK (app_can_access_project("projectId"));

CREATE POLICY project_update_access ON "ProjectUpdate"
  USING (app_can_access_project("projectId"))
  WITH CHECK (app_can_access_project("projectId"));

CREATE POLICY update_comment_access ON "UpdateComment"
  USING (
    EXISTS (
      SELECT 1 FROM "ProjectUpdate" update
      WHERE update.id = "UpdateComment"."projectUpdateId"
        AND app_can_access_project(update."projectId")
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "ProjectUpdate" update
      WHERE update.id = "UpdateComment"."projectUpdateId"
        AND app_can_access_project(update."projectId")
    )
  );

CREATE POLICY service_request_access ON "ServiceRequest"
  USING (app_can_access_request(id))
  WITH CHECK (app_can_access_project("projectId"));

CREATE POLICY request_message_access ON "RequestMessage"
  USING (app_can_access_request("serviceRequestId"))
  WITH CHECK (app_can_access_request("serviceRequestId"));

CREATE POLICY attachment_access ON "Attachment"
  USING (
    app_is_platform_admin()
    OR (
      "serviceRequestId" IS NOT NULL
      AND app_can_access_request("serviceRequestId")
    )
    OR (
      "serviceRequestId" IS NULL
      AND app_can_access_project("projectId")
    )
  )
  WITH CHECK (
    app_is_platform_admin()
    OR (
      "serviceRequestId" IS NOT NULL
      AND app_can_access_request("serviceRequestId")
    )
    OR (
      "serviceRequestId" IS NULL
      AND app_can_access_project("projectId")
    )
  );

CREATE POLICY notification_access ON "Notification"
  USING (app_is_platform_admin() OR "userId" = app_user_id())
  WITH CHECK (app_is_platform_admin() OR "userId" = app_user_id());

CREATE POLICY event_access ON "EventRecord"
  USING (
    app_is_platform_admin()
    OR "userId" = app_user_id()
    OR app_can_access_space("customerSpaceId")
    OR app_can_access_project("projectId")
    OR app_can_access_request("serviceRequestId")
  )
  WITH CHECK (
    app_is_platform_admin()
    OR "userId" = app_user_id()
    OR app_can_access_space("customerSpaceId")
    OR app_can_access_project("projectId")
    OR app_can_access_request("serviceRequestId")
  );

CREATE POLICY audit_log_access ON "AuditLog"
  USING (app_is_platform_admin())
  WITH CHECK (app_is_platform_admin() OR "actorId" = app_user_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO service_platform_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO service_platform_app;
