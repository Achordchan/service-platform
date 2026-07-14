-- Multi-assignee support for service requests.
CREATE TABLE IF NOT EXISTS "RequestAssignee" (
  "id" TEXT NOT NULL,
  "serviceRequestId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "assignedById" TEXT,
  CONSTRAINT "RequestAssignee_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "RequestAssignee_serviceRequestId_userId_key"
  ON "RequestAssignee"("serviceRequestId", "userId");
CREATE INDEX IF NOT EXISTS "RequestAssignee_userId_idx" ON "RequestAssignee"("userId");
CREATE INDEX IF NOT EXISTS "RequestAssignee_serviceRequestId_idx"
  ON "RequestAssignee"("serviceRequestId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'RequestAssignee_serviceRequestId_fkey'
  ) THEN
    ALTER TABLE "RequestAssignee"
      ADD CONSTRAINT "RequestAssignee_serviceRequestId_fkey"
      FOREIGN KEY ("serviceRequestId") REFERENCES "ServiceRequest"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'RequestAssignee_userId_fkey'
  ) THEN
    ALTER TABLE "RequestAssignee"
      ADD CONSTRAINT "RequestAssignee_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

INSERT INTO "RequestAssignee" ("id", "serviceRequestId", "userId", "assignedAt")
SELECT
  md5(random()::text || clock_timestamp()::text),
  request.id,
  request."assigneeId",
  request."updatedAt"
FROM "ServiceRequest" request
WHERE request."assigneeId" IS NOT NULL
ON CONFLICT ("serviceRequestId", "userId") DO NOTHING;

-- Drop ambiguous overloads first, keep a single 2-arg helper.
DROP FUNCTION IF EXISTS app_can_access_request_fields(text, text, text);
DROP FUNCTION IF EXISTS app_can_access_request_fields(text, text);

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
      AND (
        app_is_platform_admin()
        OR EXISTS (
          SELECT 1
          FROM "Project" project
          JOIN "Membership" membership
            ON membership."customerSpaceId" = project."customerSpaceId"
          WHERE project.id = request."projectId"
            AND membership."userId" = app_user_id()
        )
        OR request."assigneeId" = app_user_id()
        OR EXISTS (
          SELECT 1
          FROM "RequestAssignee" assignee
          WHERE assignee."serviceRequestId" = request.id
            AND assignee."userId" = app_user_id()
        )
        OR EXISTS (
          SELECT 1
          FROM "ProjectStaff" staff
          WHERE staff."projectId" = request."projectId"
            AND staff."userId" = app_user_id()
            AND staff.role = 'PROJECT_MANAGER'
        )
      )
  );
$$;

DROP POLICY IF EXISTS service_request_select ON "ServiceRequest";
DROP POLICY IF EXISTS service_request_update ON "ServiceRequest";

CREATE POLICY service_request_select ON "ServiceRequest"
  FOR SELECT
  USING (app_can_access_request(id));

CREATE POLICY service_request_update ON "ServiceRequest"
  FOR UPDATE
  USING (app_can_access_request(id))
  WITH CHECK (app_can_access_request(id));

ALTER TABLE "RequestAssignee" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS request_assignee_access ON "RequestAssignee";
CREATE POLICY request_assignee_access ON "RequestAssignee"
  USING (app_can_access_request("serviceRequestId") OR app_is_platform_admin())
  WITH CHECK (app_can_access_request("serviceRequestId") OR app_is_platform_admin());

GRANT SELECT, INSERT, UPDATE, DELETE ON "RequestAssignee" TO service_platform_app;
GRANT EXECUTE ON FUNCTION app_can_access_request_fields(text, text) TO service_platform_app;
GRANT EXECUTE ON FUNCTION app_can_access_request(text) TO service_platform_app;
