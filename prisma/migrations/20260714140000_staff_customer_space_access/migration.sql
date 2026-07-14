-- Allow project staff to read the customer space of projects they are assigned to.
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
    )
    OR EXISTS (
      SELECT 1
      FROM "Project" project
      JOIN "ProjectStaff" staff
        ON staff."projectId" = project.id
      WHERE project."customerSpaceId" = target_space_id
        AND staff."userId" = app_user_id()
    );
$$;

GRANT EXECUTE ON FUNCTION app_can_access_space(text) TO service_platform_app;
