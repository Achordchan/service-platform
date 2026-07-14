GRANT USAGE ON SCHEMA public TO service_platform_app;

CREATE OR REPLACE FUNCTION app_user_relevant_to_project(
  target_user_id text,
  target_project_id text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM "User" app_user
    WHERE app_user.id = target_user_id
      AND (
        app_user."platformRole" = 'PLATFORM_ADMIN'
        OR EXISTS (
          SELECT 1
          FROM "ProjectStaff" staff
          WHERE staff."projectId" = target_project_id
            AND staff."userId" = target_user_id
        )
        OR EXISTS (
          SELECT 1
          FROM "Project" project
          JOIN "Membership" membership
            ON membership."customerSpaceId" = project."customerSpaceId"
          WHERE project.id = target_project_id
            AND membership."userId" = target_user_id
        )
      )
  );
$$;

GRANT EXECUTE ON FUNCTION app_user_relevant_to_project(text, text)
  TO service_platform_app;

DROP POLICY notification_access ON "Notification";
CREATE POLICY notification_access ON "Notification"
  USING (
    app_is_platform_admin()
    OR "userId" = app_user_id()
  )
  WITH CHECK (
    app_is_platform_admin()
    OR "userId" = app_user_id()
    OR (
      "projectId" IS NOT NULL
      AND app_can_access_project("projectId")
      AND app_user_relevant_to_project("userId", "projectId")
    )
  );

DROP POLICY event_access ON "EventRecord";
CREATE POLICY event_access ON "EventRecord"
  USING (
    app_is_platform_admin()
    OR (
      "userId" IS NOT NULL
      AND "userId" = app_user_id()
    )
    OR (
      "userId" IS NULL
      AND (
        app_can_access_space("customerSpaceId")
        OR app_can_access_project("projectId")
        OR app_can_access_request("serviceRequestId")
      )
    )
  )
  WITH CHECK (
    app_is_platform_admin()
    OR "userId" = app_user_id()
    OR (
      "userId" IS NOT NULL
      AND (
        app_can_access_space("customerSpaceId")
        OR app_can_access_project("projectId")
        OR app_can_access_request("serviceRequestId")
      )
    )
    OR (
      "userId" IS NULL
      AND (
        app_can_access_space("customerSpaceId")
        OR app_can_access_project("projectId")
        OR app_can_access_request("serviceRequestId")
      )
    )
  );
