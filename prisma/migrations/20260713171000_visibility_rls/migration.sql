CREATE OR REPLACE FUNCTION app_is_staff()
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(current_setting('app.is_staff', true), 'false') = 'true';
$$;

GRANT EXECUTE ON FUNCTION app_is_staff() TO service_platform_app;

DROP POLICY project_update_access ON "ProjectUpdate";
CREATE POLICY project_update_access ON "ProjectUpdate"
  USING (
    app_can_access_project("projectId")
    AND (app_is_staff() OR visibility = 'CUSTOMER_VISIBLE')
  )
  WITH CHECK (
    app_can_access_project("projectId")
    AND (app_is_staff() OR visibility = 'CUSTOMER_VISIBLE')
  );

DROP POLICY update_comment_access ON "UpdateComment";
CREATE POLICY update_comment_access ON "UpdateComment"
  USING (
    EXISTS (
      SELECT 1
      FROM "ProjectUpdate" project_update
      WHERE project_update.id = "UpdateComment"."projectUpdateId"
        AND app_can_access_project(project_update."projectId")
    )
    AND (app_is_staff() OR visibility = 'CUSTOMER_VISIBLE')
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM "ProjectUpdate" project_update
      WHERE project_update.id = "UpdateComment"."projectUpdateId"
        AND app_can_access_project(project_update."projectId")
    )
    AND (app_is_staff() OR visibility = 'CUSTOMER_VISIBLE')
  );

DROP POLICY request_message_access ON "RequestMessage";
CREATE POLICY request_message_access ON "RequestMessage"
  USING (
    app_can_access_request("serviceRequestId")
    AND (app_is_staff() OR visibility = 'CUSTOMER_VISIBLE')
  )
  WITH CHECK (
    app_can_access_request("serviceRequestId")
    AND (app_is_staff() OR visibility = 'CUSTOMER_VISIBLE')
  );

DROP POLICY attachment_access ON "Attachment";
CREATE POLICY attachment_access ON "Attachment"
  USING (
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
      )
    )
  )
  WITH CHECK (
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
      )
    )
  );
