-- Customer-space membership remains the customer path.
-- Project staff technicians may only access assigned requests.
-- Project managers and platform admins retain broader request access.
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
        EXISTS (
          SELECT 1
          FROM "Membership" membership
          WHERE membership."customerSpaceId" = project."customerSpaceId"
            AND membership."userId" = app_user_id()
        )
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

GRANT EXECUTE ON FUNCTION app_can_access_request(text) TO service_platform_app;
