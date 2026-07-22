ALTER TABLE "Attachment"
ADD COLUMN "milestoneId" TEXT;

ALTER TABLE "Attachment"
ADD CONSTRAINT "Attachment_milestoneId_fkey"
FOREIGN KEY ("milestoneId") REFERENCES "Milestone"(id)
ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "Attachment_milestoneId_idx"
ON "Attachment"("milestoneId");

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
    OR NEW."milestoneId" IS DISTINCT FROM OLD."milestoneId"
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
