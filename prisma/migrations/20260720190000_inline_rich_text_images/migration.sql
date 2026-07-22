ALTER TABLE "Attachment"
ADD COLUMN inline BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "Attachment_inline_createdAt_idx"
ON "Attachment"(inline, "createdAt");

CREATE OR REPLACE FUNCTION app_external_attachment_update_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF app_external_contact_id() IS NULL THEN
    RETURN NEW;
  END IF;

  IF OLD.inline IS NOT TRUE
    OR OLD."uploadedByExternalContactId" IS DISTINCT FROM app_external_contact_id()
    OR OLD."requestMessageId" IS NOT NULL
    OR NEW."requestMessageId" IS NULL
    OR NEW.id IS DISTINCT FROM OLD.id
    OR NEW."originalName" IS DISTINCT FROM OLD."originalName"
    OR NEW."storageKey" IS DISTINCT FROM OLD."storageKey"
    OR NEW."mimeType" IS DISTINCT FROM OLD."mimeType"
    OR NEW.size IS DISTINCT FROM OLD.size
    OR NEW.visibility IS DISTINCT FROM OLD.visibility
    OR NEW.inline IS DISTINCT FROM OLD.inline
    OR NEW."customerSpaceId" IS DISTINCT FROM OLD."customerSpaceId"
    OR NEW."projectId" IS DISTINCT FROM OLD."projectId"
    OR NEW."projectUpdateId" IS DISTINCT FROM OLD."projectUpdateId"
    OR NEW."updateCommentId" IS DISTINCT FROM OLD."updateCommentId"
    OR NEW."serviceRequestId" IS DISTINCT FROM OLD."serviceRequestId"
    OR NEW."uploadedById" IS DISTINCT FROM OLD."uploadedById"
    OR NEW."uploadedByExternalContactId" IS DISTINCT FROM OLD."uploadedByExternalContactId"
    OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
    OR NOT EXISTS (
      SELECT 1
      FROM "RequestMessage" message
      WHERE message.id = NEW."requestMessageId"
        AND message."serviceRequestId" = OLD."serviceRequestId"
        AND message."externalAuthorId" = app_external_contact_id()
        AND message.visibility = 'CUSTOMER_VISIBLE'
    )
  THEN
    RAISE EXCEPTION 'external contact cannot modify this attachment';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS external_attachment_update_guard ON "Attachment";
CREATE TRIGGER external_attachment_update_guard
BEFORE UPDATE ON "Attachment"
FOR EACH ROW EXECUTE FUNCTION app_external_attachment_update_guard();

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
