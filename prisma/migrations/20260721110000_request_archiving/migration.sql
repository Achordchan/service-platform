ALTER TABLE "ServiceRequest"
ADD COLUMN "archivedAt" TIMESTAMP(3);

CREATE INDEX "ServiceRequest_projectId_archivedAt_status_idx"
ON "ServiceRequest"("projectId", "archivedAt", status);

CREATE OR REPLACE FUNCTION app_external_service_request_update_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF app_external_contact_id() IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.number IS DISTINCT FROM OLD.number
     OR NEW.title IS DISTINCT FROM OLD.title
     OR NEW.description IS DISTINCT FROM OLD.description
     OR NEW.priority IS DISTINCT FROM OLD.priority
     OR NEW."projectId" IS DISTINCT FROM OLD."projectId"
     OR NEW."categoryId" IS DISTINCT FROM OLD."categoryId"
     OR NEW."createdById" IS DISTINCT FROM OLD."createdById"
     OR NEW."createdByExternalContactId" IS DISTINCT FROM OLD."createdByExternalContactId"
     OR NEW."assigneeId" IS DISTINCT FROM OLD."assigneeId"
     OR NEW."archivedAt" IS DISTINCT FROM OLD."archivedAt"
     OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
  THEN
    RAISE EXCEPTION 'external contact cannot modify protected service request fields'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
