CREATE OR REPLACE FUNCTION app_project_customer_user_ids(target_project_id text)
RETURNS TABLE (user_id text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT DISTINCT membership."userId"
  FROM "Project" project
  JOIN "Membership" membership
    ON membership."customerSpaceId" = project."customerSpaceId"
  WHERE project.id = target_project_id
    AND app_can_access_project(target_project_id)
$$;

REVOKE ALL ON FUNCTION app_project_customer_user_ids(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_project_customer_user_ids(text)
  TO service_platform_app;
