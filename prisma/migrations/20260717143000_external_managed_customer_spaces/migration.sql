CREATE TYPE "CustomerSpaceKind" AS ENUM ('STANDARD', 'EXTERNAL_MANAGED');

ALTER TABLE "CustomerSpace"
  ADD COLUMN "kind" "CustomerSpaceKind" NOT NULL DEFAULT 'STANDARD';

CREATE INDEX "CustomerSpace_kind_status_idx"
  ON "CustomerSpace"("kind", "status");

-- EXTERNAL_INTEGRATION projects created before managed spaces may still sit on
-- STANDARD customer spaces. Only auto-migrate projects with no formal customer
-- footprint. Detect customer-authored content via Membership (not mere non-null
-- staff author ids). Include project updates/comments/attachments. Any match blocks deploy.
DO $$
DECLARE
  project_row RECORD;
  managed_space_id TEXT;
  owner_id TEXT;
  formal_request_count INTEGER;
  formal_message_count INTEGER;
  formal_update_count INTEGER;
  formal_comment_count INTEGER;
  formal_attachment_count INTEGER;
  formal_notification_count INTEGER;
  formal_membership_count INTEGER;
BEGIN
  FOR project_row IN
    SELECT
      p.id AS project_id,
      p.title AS project_title,
      p."customerSpaceId" AS customer_space_id,
      p."createdById" AS created_by_id,
      cs."ownerId" AS space_owner_id
    FROM "Project" p
    INNER JOIN "CustomerSpace" cs ON cs.id = p."customerSpaceId"
    WHERE p.kind = 'EXTERNAL_INTEGRATION'
      AND cs.kind = 'STANDARD'
  LOOP
    -- Requests created by formal customer-space members (exclude staff-only authors).
    SELECT COUNT(*)::int
      INTO formal_request_count
    FROM "ServiceRequest" sr
    WHERE sr."projectId" = project_row.project_id
      AND sr."createdById" IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM "Membership" m
        WHERE m."customerSpaceId" = project_row.customer_space_id
          AND m."userId" = sr."createdById"
      );

    -- Non-system chat messages authored by customer-space members.
    SELECT COUNT(*)::int
      INTO formal_message_count
    FROM "RequestMessage" rm
    INNER JOIN "ServiceRequest" sr ON sr.id = rm."serviceRequestId"
    WHERE sr."projectId" = project_row.project_id
      AND rm."authorId" IS NOT NULL
      AND COALESCE(rm."isSystem", false) = false
      AND EXISTS (
        SELECT 1
        FROM "Membership" m
        WHERE m."customerSpaceId" = project_row.customer_space_id
          AND m."userId" = rm."authorId"
      );

    -- Project updates authored by customer-space members.
    SELECT COUNT(*)::int
      INTO formal_update_count
    FROM "ProjectUpdate" pu
    WHERE pu."projectId" = project_row.project_id
      AND EXISTS (
        SELECT 1
        FROM "Membership" m
        WHERE m."customerSpaceId" = project_row.customer_space_id
          AND m."userId" = pu."authorId"
      );

    -- Update comments authored by customer-space members.
    SELECT COUNT(*)::int
      INTO formal_comment_count
    FROM "UpdateComment" uc
    INNER JOIN "ProjectUpdate" pu ON pu.id = uc."projectUpdateId"
    WHERE pu."projectId" = project_row.project_id
      AND EXISTS (
        SELECT 1
        FROM "Membership" m
        WHERE m."customerSpaceId" = project_row.customer_space_id
          AND m."userId" = uc."authorId"
      );

    -- Attachments uploaded by customer-space members on project / request /
    -- update / comment surfaces (customers may attach without sending a message).
    SELECT COUNT(*)::int
      INTO formal_attachment_count
    FROM "Attachment" a
    WHERE a."uploadedById" IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM "Membership" m
        WHERE m."customerSpaceId" = project_row.customer_space_id
          AND m."userId" = a."uploadedById"
      )
      AND (
        a."projectId" = project_row.project_id
        OR a."serviceRequestId" IN (
          SELECT id FROM "ServiceRequest" WHERE "projectId" = project_row.project_id
        )
        OR a."projectUpdateId" IN (
          SELECT id FROM "ProjectUpdate" WHERE "projectId" = project_row.project_id
        )
        OR a."updateCommentId" IN (
          SELECT uc.id
          FROM "UpdateComment" uc
          INNER JOIN "ProjectUpdate" pu ON pu.id = uc."projectUpdateId"
          WHERE pu."projectId" = project_row.project_id
        )
      );

    -- Notifications already delivered to customer-space members for this project.
    SELECT COUNT(*)::int
      INTO formal_notification_count
    FROM "Notification" n
    WHERE (
        n."projectId" = project_row.project_id
        OR n."serviceRequestId" IN (
          SELECT id FROM "ServiceRequest" WHERE "projectId" = project_row.project_id
        )
      )
      AND EXISTS (
        SELECT 1
        FROM "Membership" m
        WHERE m."customerSpaceId" = project_row.customer_space_id
          AND m."userId" = n."userId"
      );

    -- Extra customer members on the shared STANDARD space (not just the owner row).
    SELECT COUNT(*)::int
      INTO formal_membership_count
    FROM "Membership" m
    WHERE m."customerSpaceId" = project_row.customer_space_id
      AND m."userId" <> project_row.space_owner_id
      AND m.role = 'MEMBER';

    IF formal_request_count > 0
      OR formal_message_count > 0
      OR formal_update_count > 0
      OR formal_comment_count > 0
      OR formal_attachment_count > 0
      OR formal_notification_count > 0
      OR formal_membership_count > 0
    THEN
      RAISE EXCEPTION
        'Refusing to auto-migrate EXTERNAL_INTEGRATION project % (%) from STANDARD space %: formal customer data detected (requests=%, messages=%, updates=%, comments=%, attachments=%, member_notifications=%, extra_members=%). Handle manually before deploy.',
        project_row.project_id,
        project_row.project_title,
        project_row.customer_space_id,
        formal_request_count,
        formal_message_count,
        formal_update_count,
        formal_comment_count,
        formal_attachment_count,
        formal_notification_count,
        formal_membership_count;
    END IF;

    owner_id := COALESCE(project_row.created_by_id, project_row.space_owner_id);
    IF owner_id IS NULL THEN
      RAISE EXCEPTION
        'Cannot migrate EXTERNAL_INTEGRATION project %: missing owner for managed space',
        project_row.project_id;
    END IF;

    managed_space_id := md5(
      random()::text || clock_timestamp()::text || project_row.project_id
    );

    INSERT INTO "CustomerSpace" (
      id,
      name,
      slug,
      kind,
      "memberLimit",
      status,
      "ownerId",
      "createdAt",
      "updatedAt"
    )
    VALUES (
      managed_space_id,
      left('Sub2API · ' || project_row.project_title, 200),
      left('external-' || replace(managed_space_id, '-', ''), 60),
      'EXTERNAL_MANAGED',
      0,
      'ACTIVE',
      owner_id,
      NOW(),
      NOW()
    );

    UPDATE "Project"
    SET
      "customerSpaceId" = managed_space_id,
      "updatedAt" = NOW()
    WHERE id = project_row.project_id;

    UPDATE "Attachment"
    SET "customerSpaceId" = managed_space_id
    WHERE "projectId" = project_row.project_id
       OR "serviceRequestId" IN (
            SELECT id FROM "ServiceRequest" WHERE "projectId" = project_row.project_id
          )
       OR "projectUpdateId" IN (
            SELECT id FROM "ProjectUpdate" WHERE "projectId" = project_row.project_id
          )
       OR "updateCommentId" IN (
            SELECT uc.id
            FROM "UpdateComment" uc
            INNER JOIN "ProjectUpdate" pu ON pu.id = uc."projectUpdateId"
            WHERE pu."projectId" = project_row.project_id
          );

    UPDATE "Notification"
    SET "customerSpaceId" = managed_space_id
    WHERE "projectId" = project_row.project_id
       OR "serviceRequestId" IN (
            SELECT id FROM "ServiceRequest" WHERE "projectId" = project_row.project_id
          );

    UPDATE "EventRecord"
    SET "customerSpaceId" = managed_space_id
    WHERE "projectId" = project_row.project_id
       OR "serviceRequestId" IN (
            SELECT id FROM "ServiceRequest" WHERE "projectId" = project_row.project_id
          );

    UPDATE "AuditLog"
    SET "customerSpaceId" = managed_space_id
    WHERE "projectId" = project_row.project_id
       OR "serviceRequestId" IN (
            SELECT id FROM "ServiceRequest" WHERE "projectId" = project_row.project_id
          );
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM "Project" p
    INNER JOIN "CustomerSpace" cs ON cs.id = p."customerSpaceId"
    WHERE p.kind = 'EXTERNAL_INTEGRATION'
      AND cs.kind <> 'EXTERNAL_MANAGED'
  ) THEN
    RAISE EXCEPTION
      'External integration projects remain on non-managed customer spaces after migration';
  END IF;
END $$;
