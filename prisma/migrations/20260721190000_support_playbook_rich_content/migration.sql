ALTER TABLE "SupportPlaybook"
  ADD COLUMN "content" TEXT,
  ADD COLUMN "deletedAt" TIMESTAMP(3);

UPDATE "SupportPlaybook"
SET "content" = CONCAT(
  '<p>', "introduction", '</p><ol>',
  (
    SELECT string_agg(CONCAT('<li>', value, '</li>'), '' ORDER BY ordinal)
    FROM jsonb_array_elements_text("steps") WITH ORDINALITY AS item(value, ordinal)
  ),
  '</ol>'
)
WHERE "content" IS NULL;

DROP INDEX "SupportPlaybook_active_sortOrder_title_idx";
CREATE INDEX "SupportPlaybook_deletedAt_active_sortOrder_title_idx"
  ON "SupportPlaybook"("deletedAt", "active", "sortOrder", "title");

ALTER TABLE "Attachment"
  ALTER COLUMN "customerSpaceId" DROP NOT NULL,
  ADD COLUMN "supportPlaybookKey" TEXT;

ALTER TABLE "Attachment"
  ADD CONSTRAINT "Attachment_supportPlaybookKey_fkey"
  FOREIGN KEY ("supportPlaybookKey") REFERENCES "SupportPlaybook"("key")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Attachment_supportPlaybookKey_idx"
  ON "Attachment"("supportPlaybookKey");

DROP POLICY IF EXISTS attachment_select ON "Attachment";
CREATE POLICY attachment_select ON "Attachment"
  FOR SELECT USING (
    (app_is_staff() OR visibility = 'CUSTOMER_VISIBLE')
    AND (
      app_is_platform_admin()
      OR ("serviceRequestId" IS NOT NULL AND app_can_access_request("serviceRequestId"))
      OR ("serviceRequestId" IS NULL AND "projectId" IS NOT NULL AND app_can_access_project("projectId"))
      OR (
        "supportPlaybookKey" IS NOT NULL
        AND (
          app_is_staff()
          OR EXISTS (
            SELECT 1
            FROM "RequestMessage" message
            WHERE message."supportPlaybookKey" = "Attachment"."supportPlaybookKey"
              AND message.visibility = 'CUSTOMER_VISIBLE'
              AND app_can_access_request(message."serviceRequestId")
          )
        )
      )
    )
  );

DROP POLICY IF EXISTS attachment_insert ON "Attachment";
CREATE POLICY attachment_insert ON "Attachment"
  FOR INSERT WITH CHECK (
    (app_is_staff() OR visibility = 'CUSTOMER_VISIBLE')
    AND (
      app_is_platform_admin()
      OR ("serviceRequestId" IS NOT NULL AND app_can_access_request("serviceRequestId"))
      OR ("serviceRequestId" IS NULL AND "projectId" IS NOT NULL AND app_can_access_project("projectId"))
    )
    AND (
      app_external_contact_id() IS NULL
      OR (
        "uploadedById" IS NULL
        AND "uploadedByExternalContactId" = app_external_contact_id()
        AND visibility = 'CUSTOMER_VISIBLE'
      )
    )
  );

DROP POLICY IF EXISTS attachment_update ON "Attachment";
CREATE POLICY attachment_update ON "Attachment"
  FOR UPDATE
  USING (
    (
      app_external_contact_id() IS NULL
      AND (
        app_is_platform_admin()
        OR ("serviceRequestId" IS NOT NULL AND app_can_access_request("serviceRequestId"))
        OR ("serviceRequestId" IS NULL AND "projectId" IS NOT NULL AND app_can_access_project("projectId"))
      )
    )
    OR (
      app_external_contact_id() IS NOT NULL
      AND inline = true
      AND "uploadedByExternalContactId" = app_external_contact_id()
      AND "requestMessageId" IS NULL
      AND "serviceRequestId" IS NOT NULL
      AND app_can_access_request("serviceRequestId")
    )
  )
  WITH CHECK (
    (
      app_external_contact_id() IS NULL
      AND (
        app_is_platform_admin()
        OR ("serviceRequestId" IS NOT NULL AND app_can_access_request("serviceRequestId"))
        OR ("serviceRequestId" IS NULL AND "projectId" IS NOT NULL AND app_can_access_project("projectId"))
      )
    )
    OR (
      app_external_contact_id() IS NOT NULL
      AND inline = true
      AND "uploadedByExternalContactId" = app_external_contact_id()
      AND "requestMessageId" IS NOT NULL
      AND "serviceRequestId" IS NOT NULL
      AND app_can_access_request("serviceRequestId")
    )
  );

DROP POLICY IF EXISTS attachment_delete ON "Attachment";
CREATE POLICY attachment_delete ON "Attachment"
  FOR DELETE USING (
    app_external_contact_id() IS NULL
    AND (
      app_is_platform_admin()
      OR ("serviceRequestId" IS NOT NULL AND app_can_access_request("serviceRequestId"))
      OR ("serviceRequestId" IS NULL AND "projectId" IS NOT NULL AND app_can_access_project("projectId"))
    )
  );
