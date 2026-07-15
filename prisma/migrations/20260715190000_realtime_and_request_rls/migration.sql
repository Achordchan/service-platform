ALTER TYPE "EventType" ADD VALUE IF NOT EXISTS 'REQUEST_UPDATED';

-- ServiceRequest INSERT ... RETURNING also evaluates the SELECT policy.
-- The policy must evaluate the candidate row directly instead of looking it
-- up by id before PostgreSQL has made the row visible.
CREATE OR REPLACE FUNCTION app_can_access_request_row(
  target_request_id text,
  target_project_id text,
  target_assignee_id text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    app_can_access_request_fields(target_project_id, target_assignee_id)
    OR EXISTS (
      SELECT 1
      FROM "RequestAssignee" assignee
      WHERE assignee."serviceRequestId" = target_request_id
        AND assignee."userId" = app_user_id()
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
      AND app_can_access_request_row(
        request.id,
        request."projectId",
        request."assigneeId"
      )
  );
$$;

DROP POLICY IF EXISTS service_request_select ON "ServiceRequest";
DROP POLICY IF EXISTS service_request_update ON "ServiceRequest";

CREATE POLICY service_request_select ON "ServiceRequest"
  FOR SELECT
  USING (
    app_can_access_request_row(id, "projectId", "assigneeId")
  );

CREATE POLICY service_request_update ON "ServiceRequest"
  FOR UPDATE
  USING (
    app_can_access_request_row(id, "projectId", "assigneeId")
  )
  WITH CHECK (
    app_can_access_request_row(id, "projectId", "assigneeId")
  );

GRANT EXECUTE ON FUNCTION app_can_access_request_row(text, text, text)
  TO service_platform_app;
GRANT EXECUTE ON FUNCTION app_can_access_request(text)
  TO service_platform_app;
