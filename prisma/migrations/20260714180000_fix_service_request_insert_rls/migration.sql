-- ServiceRequest INSERT ... RETURNING evaluates SELECT policies on the new row.
-- app_can_access_request(id) looks the row up by id and can fail mid-insert.
-- Use project/assignee fields on the row itself for ServiceRequest policies.

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
        EXISTS (
          SELECT 1
          FROM "Membership" membership
          WHERE membership."customerSpaceId" = project."customerSpaceId"
            AND membership."userId" = app_user_id()
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

CREATE OR REPLACE FUNCTION app_can_access_request(target_request_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM "ServiceRequest" request
    WHERE request.id = target_request_id
      AND app_can_access_request_fields(
        request."projectId",
        request."assigneeId"
      )
  );
$$;

DROP POLICY IF EXISTS service_request_access ON "ServiceRequest";
DROP POLICY IF EXISTS service_request_select ON "ServiceRequest";
DROP POLICY IF EXISTS service_request_insert ON "ServiceRequest";
DROP POLICY IF EXISTS service_request_update ON "ServiceRequest";
DROP POLICY IF EXISTS service_request_delete ON "ServiceRequest";

CREATE POLICY service_request_select ON "ServiceRequest"
  FOR SELECT
  USING (app_can_access_request_fields("projectId", "assigneeId"));

CREATE POLICY service_request_insert ON "ServiceRequest"
  FOR INSERT
  WITH CHECK (app_can_access_project("projectId"));

CREATE POLICY service_request_update ON "ServiceRequest"
  FOR UPDATE
  USING (app_can_access_request_fields("projectId", "assigneeId"))
  WITH CHECK (app_can_access_request_fields("projectId", "assigneeId"));

CREATE POLICY service_request_delete ON "ServiceRequest"
  FOR DELETE
  USING (
    app_is_platform_admin()
    OR EXISTS (
      SELECT 1
      FROM "ProjectStaff" staff
      WHERE staff."projectId" = "ServiceRequest"."projectId"
        AND staff."userId" = app_user_id()
        AND staff.role = 'PROJECT_MANAGER'
    )
  );

GRANT EXECUTE ON FUNCTION app_can_access_request_fields(text, text) TO service_platform_app;
GRANT EXECUTE ON FUNCTION app_can_access_request(text) TO service_platform_app;
