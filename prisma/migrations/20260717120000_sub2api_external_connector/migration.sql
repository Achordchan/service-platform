CREATE TYPE "ProjectKind" AS ENUM ('STANDARD', 'EXTERNAL_INTEGRATION');
CREATE TYPE "ProjectPluginBindingStatus" AS ENUM ('DRAFT', 'ACTIVE', 'DISABLED', 'ARCHIVED');
CREATE TYPE "ExternalContactStatus" AS ENUM ('ACTIVE', 'BLOCKED');

ALTER TABLE "Project"
  ADD COLUMN "kind" "ProjectKind" NOT NULL DEFAULT 'STANDARD';

ALTER TABLE "ServiceRequest"
  ALTER COLUMN "createdById" DROP NOT NULL,
  ADD COLUMN "createdByExternalContactId" TEXT;

ALTER TABLE "RequestMessage"
  ALTER COLUMN "authorId" DROP NOT NULL,
  ADD COLUMN "externalAuthorId" TEXT;

ALTER TABLE "Attachment"
  ALTER COLUMN "uploadedById" DROP NOT NULL,
  ADD COLUMN "uploadedByExternalContactId" TEXT;

ALTER TABLE "AuditLog"
  ADD COLUMN "externalActorId" TEXT;

CREATE TABLE "ProjectPluginBinding" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "pluginKey" TEXT NOT NULL,
  "publicId" TEXT NOT NULL,
  "status" "ProjectPluginBindingStatus" NOT NULL DEFAULT 'DRAFT',
  "config" JSONB NOT NULL DEFAULT '{}',
  "archivedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProjectPluginBinding_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Sub2ApiConnection" (
  "bindingId" TEXT NOT NULL,
  "baseUrl" TEXT NOT NULL,
  "sourceOrigin" TEXT NOT NULL,
  "adminApiKeyEncrypted" TEXT,
  "emailNotificationsEnabled" BOOLEAN NOT NULL DEFAULT true,
  "customerMemberNotificationsEnabled" BOOLEAN NOT NULL DEFAULT false,
  "healthStatus" TEXT NOT NULL DEFAULT 'UNKNOWN',
  "lastCheckedAt" TIMESTAMP(3),
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Sub2ApiConnection_pkey" PRIMARY KEY ("bindingId")
);

CREATE TABLE "ExternalContact" (
  "id" TEXT NOT NULL,
  "bindingId" TEXT NOT NULL,
  "externalUserId" TEXT NOT NULL,
  "email" TEXT,
  "username" TEXT,
  "displayName" TEXT NOT NULL,
  "status" "ExternalContactStatus" NOT NULL DEFAULT 'ACTIVE',
  "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ExternalContact_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ExternalEmbedSession" (
  "id" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "externalContactId" TEXT NOT NULL,
  "bindingId" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "ipAddress" TEXT,
  "userAgent" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ExternalEmbedSession_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ExternalRequestPresence" (
  "id" TEXT NOT NULL,
  "serviceRequestId" TEXT NOT NULL,
  "externalContactId" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ExternalRequestPresence_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProjectPluginBinding_publicId_key" ON "ProjectPluginBinding"("publicId");
CREATE UNIQUE INDEX "ProjectPluginBinding_projectId_pluginKey_key" ON "ProjectPluginBinding"("projectId", "pluginKey");
CREATE INDEX "ProjectPluginBinding_pluginKey_status_idx" ON "ProjectPluginBinding"("pluginKey", "status");
CREATE INDEX "ProjectPluginBinding_projectId_status_idx" ON "ProjectPluginBinding"("projectId", "status");
CREATE UNIQUE INDEX "ExternalContact_bindingId_externalUserId_key" ON "ExternalContact"("bindingId", "externalUserId");
CREATE INDEX "ExternalContact_bindingId_status_lastSeenAt_idx" ON "ExternalContact"("bindingId", "status", "lastSeenAt");
CREATE INDEX "ExternalContact_email_idx" ON "ExternalContact"("email");
CREATE UNIQUE INDEX "ExternalEmbedSession_tokenHash_key" ON "ExternalEmbedSession"("tokenHash");
CREATE INDEX "ExternalEmbedSession_externalContactId_expiresAt_idx" ON "ExternalEmbedSession"("externalContactId", "expiresAt");
CREATE INDEX "ExternalEmbedSession_bindingId_revokedAt_expiresAt_idx" ON "ExternalEmbedSession"("bindingId", "revokedAt", "expiresAt");
CREATE UNIQUE INDEX "ExternalRequestPresence_serviceRequestId_externalContactId_sessionId_key" ON "ExternalRequestPresence"("serviceRequestId", "externalContactId", "sessionId");
CREATE INDEX "ExternalRequestPresence_serviceRequestId_expiresAt_idx" ON "ExternalRequestPresence"("serviceRequestId", "expiresAt");
CREATE INDEX "ExternalRequestPresence_externalContactId_expiresAt_idx" ON "ExternalRequestPresence"("externalContactId", "expiresAt");
CREATE INDEX "ServiceRequest_createdByExternalContactId_createdAt_idx" ON "ServiceRequest"("createdByExternalContactId", "createdAt");
CREATE INDEX "RequestMessage_externalAuthorId_createdAt_idx" ON "RequestMessage"("externalAuthorId", "createdAt");
CREATE INDEX "Attachment_uploadedByExternalContactId_createdAt_idx" ON "Attachment"("uploadedByExternalContactId", "createdAt");
CREATE INDEX "AuditLog_externalActorId_createdAt_idx" ON "AuditLog"("externalActorId", "createdAt");

ALTER TABLE "ProjectPluginBinding" ADD CONSTRAINT "ProjectPluginBinding_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectPluginBinding" ADD CONSTRAINT "ProjectPluginBinding_pluginKey_fkey"
  FOREIGN KEY ("pluginKey") REFERENCES "PluginInstallation"("key") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Sub2ApiConnection" ADD CONSTRAINT "Sub2ApiConnection_bindingId_fkey"
  FOREIGN KEY ("bindingId") REFERENCES "ProjectPluginBinding"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExternalContact" ADD CONSTRAINT "ExternalContact_bindingId_fkey"
  FOREIGN KEY ("bindingId") REFERENCES "ProjectPluginBinding"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExternalEmbedSession" ADD CONSTRAINT "ExternalEmbedSession_externalContactId_fkey"
  FOREIGN KEY ("externalContactId") REFERENCES "ExternalContact"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExternalEmbedSession" ADD CONSTRAINT "ExternalEmbedSession_bindingId_fkey"
  FOREIGN KEY ("bindingId") REFERENCES "ProjectPluginBinding"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExternalRequestPresence" ADD CONSTRAINT "ExternalRequestPresence_serviceRequestId_fkey"
  FOREIGN KEY ("serviceRequestId") REFERENCES "ServiceRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExternalRequestPresence" ADD CONSTRAINT "ExternalRequestPresence_externalContactId_fkey"
  FOREIGN KEY ("externalContactId") REFERENCES "ExternalContact"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ServiceRequest" ADD CONSTRAINT "ServiceRequest_createdByExternalContactId_fkey"
  FOREIGN KEY ("createdByExternalContactId") REFERENCES "ExternalContact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RequestMessage" ADD CONSTRAINT "RequestMessage_externalAuthorId_fkey"
  FOREIGN KEY ("externalAuthorId") REFERENCES "ExternalContact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_uploadedByExternalContactId_fkey"
  FOREIGN KEY ("uploadedByExternalContactId") REFERENCES "ExternalContact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_externalActorId_fkey"
  FOREIGN KEY ("externalActorId") REFERENCES "ExternalContact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ServiceRequest" ADD CONSTRAINT "ServiceRequest_creator_exactly_one_check"
  CHECK (("createdById" IS NOT NULL) <> ("createdByExternalContactId" IS NOT NULL));
ALTER TABLE "RequestMessage" ADD CONSTRAINT "RequestMessage_author_exactly_one_check"
  CHECK (("authorId" IS NOT NULL) <> ("externalAuthorId" IS NOT NULL));
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_uploader_exactly_one_check"
  CHECK (("uploadedById" IS NOT NULL) <> ("uploadedByExternalContactId" IS NOT NULL));
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actor_at_most_one_check"
  CHECK (NOT ("actorId" IS NOT NULL AND "externalActorId" IS NOT NULL));

CREATE OR REPLACE FUNCTION app_external_contact_id()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('app.external_contact_id', true), '');
$$;

CREATE OR REPLACE FUNCTION app_external_contact_can_access_project(target_project_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM "ExternalContact" contact
    JOIN "ProjectPluginBinding" binding ON binding.id = contact."bindingId"
    JOIN "PluginInstallation" plugin ON plugin.key = binding."pluginKey"
    WHERE contact.id = app_external_contact_id()
      AND contact.status = 'ACTIVE'
      AND binding."projectId" = target_project_id
      AND binding.status = 'ACTIVE'
      AND plugin.enabled = true
  );
$$;

CREATE OR REPLACE FUNCTION app_can_access_project(target_project_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT app_is_platform_admin()
    OR EXISTS (
      SELECT 1
      FROM "Project" project
      WHERE project.id = target_project_id
        AND (
          app_can_access_space(project."customerSpaceId")
          OR EXISTS (
            SELECT 1
            FROM "ProjectStaff" staff
            WHERE staff."projectId" = project.id
              AND staff."userId" = app_user_id()
          )
        )
    );
$$;

CREATE POLICY external_project_select ON "Project"
  FOR SELECT USING (app_external_contact_can_access_project(id));

DROP FUNCTION IF EXISTS app_can_access_request_row(text, text, text) CASCADE;
CREATE OR REPLACE FUNCTION app_can_access_request_row(
  target_request_id text,
  target_project_id text,
  target_assignee_id text,
  target_external_contact_id text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    (
      app_external_contact_id() IS NOT NULL
      AND target_external_contact_id = app_external_contact_id()
      AND app_external_contact_can_access_project(target_project_id)
    )
    OR app_can_access_request_fields(target_project_id, target_assignee_id)
    OR EXISTS (
      SELECT 1
      FROM "RequestAssignee" assignee
      WHERE assignee."serviceRequestId" = target_request_id
        AND assignee."userId" = app_user_id()
    )
    OR (
      target_assignee_id IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM "RequestAssignee" assignee
        WHERE assignee."serviceRequestId" = target_request_id
      )
      AND EXISTS (
        SELECT 1 FROM "ProjectStaff" staff
        WHERE staff."projectId" = target_project_id
          AND staff."userId" = app_user_id()
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
      AND app_can_access_request_row(
        request.id,
        request."projectId",
        request."assigneeId",
        request."createdByExternalContactId"
      )
  );
$$;

DROP POLICY IF EXISTS service_request_select ON "ServiceRequest";
DROP POLICY IF EXISTS service_request_insert ON "ServiceRequest";
DROP POLICY IF EXISTS service_request_update ON "ServiceRequest";

CREATE POLICY service_request_select ON "ServiceRequest"
  FOR SELECT USING (
    app_can_access_request_row(id, "projectId", "assigneeId", "createdByExternalContactId")
  );
CREATE POLICY service_request_insert ON "ServiceRequest"
  FOR INSERT WITH CHECK (
    (
      app_external_contact_id() IS NOT NULL
      AND "createdById" IS NULL
      AND "createdByExternalContactId" = app_external_contact_id()
      AND app_external_contact_can_access_project("projectId")
    )
    OR (
      app_external_contact_id() IS NULL
      AND app_can_access_project("projectId")
    )
  );
CREATE POLICY service_request_update ON "ServiceRequest"
  FOR UPDATE
  USING (app_can_access_request(id))
  WITH CHECK (app_can_access_request(id));

DROP POLICY IF EXISTS request_message_access ON "RequestMessage";
CREATE POLICY request_message_access ON "RequestMessage"
  USING (
    app_can_access_request("serviceRequestId")
    AND (app_is_staff() OR visibility = 'CUSTOMER_VISIBLE')
  )
  WITH CHECK (
    app_can_access_request("serviceRequestId")
    AND (app_is_staff() OR visibility = 'CUSTOMER_VISIBLE')
    AND (
      app_external_contact_id() IS NULL
      OR ("authorId" IS NULL AND "externalAuthorId" = app_external_contact_id())
    )
  );

DROP POLICY IF EXISTS attachment_access ON "Attachment";
CREATE POLICY attachment_access ON "Attachment"
  USING (
    (app_is_staff() OR visibility = 'CUSTOMER_VISIBLE')
    AND (
      app_is_platform_admin()
      OR ("serviceRequestId" IS NOT NULL AND app_can_access_request("serviceRequestId"))
      OR ("serviceRequestId" IS NULL AND "projectId" IS NOT NULL AND app_can_access_project("projectId"))
    )
  )
  WITH CHECK (
    (app_is_staff() OR visibility = 'CUSTOMER_VISIBLE')
    AND (
      app_is_platform_admin()
      OR ("serviceRequestId" IS NOT NULL AND app_can_access_request("serviceRequestId"))
      OR ("serviceRequestId" IS NULL AND "projectId" IS NOT NULL AND app_can_access_project("projectId"))
    )
    AND (
      app_external_contact_id() IS NULL
      OR ("uploadedById" IS NULL AND "uploadedByExternalContactId" = app_external_contact_id())
    )
  );

ALTER TABLE "ProjectPluginBinding" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Sub2ApiConnection" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ExternalContact" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ExternalEmbedSession" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ExternalRequestPresence" ENABLE ROW LEVEL SECURITY;

CREATE POLICY project_plugin_binding_access ON "ProjectPluginBinding"
  USING (app_can_access_project("projectId"))
  WITH CHECK (app_can_access_project("projectId"));
CREATE POLICY sub2api_connection_access ON "Sub2ApiConnection"
  USING (EXISTS (
    SELECT 1 FROM "ProjectPluginBinding" binding
    WHERE binding.id = "Sub2ApiConnection"."bindingId"
      AND app_can_access_project(binding."projectId")
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM "ProjectPluginBinding" binding
    WHERE binding.id = "Sub2ApiConnection"."bindingId"
      AND app_can_access_project(binding."projectId")
  ));
CREATE POLICY external_contact_access ON "ExternalContact"
  USING (
    id = app_external_contact_id()
    OR EXISTS (
      SELECT 1 FROM "ProjectPluginBinding" binding
      WHERE binding.id = "ExternalContact"."bindingId"
        AND app_can_access_project(binding."projectId")
    )
  )
  WITH CHECK (
    id = app_external_contact_id()
    OR EXISTS (
      SELECT 1 FROM "ProjectPluginBinding" binding
      WHERE binding.id = "ExternalContact"."bindingId"
        AND app_can_access_project(binding."projectId")
    )
  );
CREATE POLICY external_embed_session_access ON "ExternalEmbedSession"
  USING (
    "externalContactId" = app_external_contact_id()
    OR app_is_platform_admin()
  )
  WITH CHECK (
    "externalContactId" = app_external_contact_id()
    OR app_is_platform_admin()
  );
CREATE POLICY external_request_presence_access ON "ExternalRequestPresence"
  USING (app_can_access_request("serviceRequestId"))
  WITH CHECK (
    app_can_access_request("serviceRequestId")
    AND "externalContactId" = app_external_contact_id()
  );

DROP POLICY IF EXISTS audit_log_access ON "AuditLog";
CREATE POLICY audit_log_access ON "AuditLog"
  USING (app_is_platform_admin())
  WITH CHECK (
    app_is_platform_admin()
    OR "actorId" = app_user_id()
    OR "externalActorId" = app_external_contact_id()
  );

GRANT EXECUTE ON FUNCTION app_external_contact_id() TO service_platform_app;
GRANT EXECUTE ON FUNCTION app_external_contact_can_access_project(text) TO service_platform_app;
GRANT EXECUTE ON FUNCTION app_can_access_request_row(text, text, text, text) TO service_platform_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "ProjectPluginBinding" TO service_platform_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "Sub2ApiConnection" TO service_platform_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "ExternalContact" TO service_platform_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "ExternalEmbedSession" TO service_platform_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "ExternalRequestPresence" TO service_platform_app;


-- Tighten external contact write surface (API is the only intended writer).
DROP POLICY IF EXISTS service_request_update ON "ServiceRequest";
CREATE POLICY service_request_update ON "ServiceRequest"
  FOR UPDATE
  USING (
    (
      app_external_contact_id() IS NULL
      AND app_can_access_request(id)
    )
    OR (
      app_external_contact_id() IS NOT NULL
      AND "createdByExternalContactId" = app_external_contact_id()
      AND app_external_contact_can_access_project("projectId")
    )
  )
  WITH CHECK (
    (
      app_external_contact_id() IS NULL
      AND app_can_access_request(id)
    )
    OR (
      app_external_contact_id() IS NOT NULL
      AND "createdByExternalContactId" = app_external_contact_id()
      AND app_external_contact_can_access_project("projectId")
      AND "createdById" IS NULL
    )
  );

DROP POLICY IF EXISTS request_message_access ON "RequestMessage";
CREATE POLICY request_message_select ON "RequestMessage"
  FOR SELECT USING (
    app_can_access_request("serviceRequestId")
    AND (app_is_staff() OR visibility = 'CUSTOMER_VISIBLE')
  );
CREATE POLICY request_message_insert ON "RequestMessage"
  FOR INSERT WITH CHECK (
    app_can_access_request("serviceRequestId")
    AND (app_is_staff() OR visibility = 'CUSTOMER_VISIBLE')
    AND (
      app_external_contact_id() IS NULL
      OR (
        "authorId" IS NULL
        AND "externalAuthorId" = app_external_contact_id()
        AND visibility = 'CUSTOMER_VISIBLE'
      )
    )
  );
CREATE POLICY request_message_update ON "RequestMessage"
  FOR UPDATE
  USING (
    app_can_access_request("serviceRequestId")
    AND app_external_contact_id() IS NULL
    AND app_is_staff()
  )
  WITH CHECK (
    app_can_access_request("serviceRequestId")
    AND app_external_contact_id() IS NULL
    AND app_is_staff()
  );
CREATE POLICY request_message_delete ON "RequestMessage"
  FOR DELETE USING (
    app_can_access_request("serviceRequestId")
    AND app_external_contact_id() IS NULL
    AND app_is_staff()
  );

DROP POLICY IF EXISTS attachment_access ON "Attachment";
CREATE POLICY attachment_select ON "Attachment"
  FOR SELECT USING (
    (app_is_staff() OR visibility = 'CUSTOMER_VISIBLE')
    AND (
      app_is_platform_admin()
      OR ("serviceRequestId" IS NOT NULL AND app_can_access_request("serviceRequestId"))
      OR ("serviceRequestId" IS NULL AND "projectId" IS NOT NULL AND app_can_access_project("projectId"))
    )
  );
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
CREATE POLICY attachment_update ON "Attachment"
  FOR UPDATE
  USING (
    app_external_contact_id() IS NULL
    AND (
      app_is_platform_admin()
      OR ("serviceRequestId" IS NOT NULL AND app_can_access_request("serviceRequestId"))
      OR ("serviceRequestId" IS NULL AND "projectId" IS NOT NULL AND app_can_access_project("projectId"))
    )
  )
  WITH CHECK (
    app_external_contact_id() IS NULL
    AND (
      app_is_platform_admin()
      OR ("serviceRequestId" IS NOT NULL AND app_can_access_request("serviceRequestId"))
      OR ("serviceRequestId" IS NULL AND "projectId" IS NOT NULL AND app_can_access_project("projectId"))
    )
  );
CREATE POLICY attachment_delete ON "Attachment"
  FOR DELETE USING (
    app_external_contact_id() IS NULL
    AND (
      app_is_platform_admin()
      OR ("serviceRequestId" IS NOT NULL AND app_can_access_request("serviceRequestId"))
      OR ("serviceRequestId" IS NULL AND "projectId" IS NOT NULL AND app_can_access_project("projectId"))
    )
  );


-- Restrict external-contact writes to status lifecycle columns on ServiceRequest.
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
     OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
  THEN
    RAISE EXCEPTION 'external contact cannot modify protected service request fields'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS service_request_external_update_guard ON "ServiceRequest";
CREATE TRIGGER service_request_external_update_guard
  BEFORE UPDATE ON "ServiceRequest"
  FOR EACH ROW
  EXECUTE FUNCTION app_external_service_request_update_guard();

DROP POLICY IF EXISTS external_contact_access ON "ExternalContact";
CREATE POLICY external_contact_select ON "ExternalContact"
  FOR SELECT USING (
    id = app_external_contact_id()
    OR EXISTS (
      SELECT 1 FROM "ProjectPluginBinding" binding
      WHERE binding.id = "ExternalContact"."bindingId"
        AND app_can_access_project(binding."projectId")
    )
  );
CREATE POLICY external_contact_insert ON "ExternalContact"
  FOR INSERT WITH CHECK (app_is_platform_admin() OR app_is_staff());
CREATE POLICY external_contact_update ON "ExternalContact"
  FOR UPDATE
  USING (
    app_is_platform_admin()
    OR app_is_staff()
    OR id = app_external_contact_id()
  )
  WITH CHECK (
    app_is_platform_admin()
    OR app_is_staff()
    OR id = app_external_contact_id()
  );
CREATE POLICY external_contact_delete ON "ExternalContact"
  FOR DELETE USING (app_is_platform_admin());

DROP POLICY IF EXISTS external_embed_session_access ON "ExternalEmbedSession";
CREATE POLICY external_embed_session_select ON "ExternalEmbedSession"
  FOR SELECT USING (
    "externalContactId" = app_external_contact_id()
    OR app_is_platform_admin()
  );
CREATE POLICY external_embed_session_insert ON "ExternalEmbedSession"
  FOR INSERT WITH CHECK (app_is_platform_admin() OR app_is_staff() OR "externalContactId" = app_external_contact_id());
CREATE POLICY external_embed_session_update ON "ExternalEmbedSession"
  FOR UPDATE
  USING (app_is_platform_admin() OR app_is_staff() OR "externalContactId" = app_external_contact_id())
  WITH CHECK (app_is_platform_admin() OR app_is_staff() OR "externalContactId" = app_external_contact_id());
CREATE POLICY external_embed_session_delete ON "ExternalEmbedSession"
  FOR DELETE USING (app_is_platform_admin());

-- External contacts must not mutate RequestAssignee rows.
DROP POLICY IF EXISTS request_assignee_access ON "RequestAssignee";
DROP POLICY IF EXISTS request_assignee_select ON "RequestAssignee";
DROP POLICY IF EXISTS request_assignee_write ON "RequestAssignee";
CREATE POLICY request_assignee_select ON "RequestAssignee"
  FOR SELECT USING (app_can_access_request("serviceRequestId"));
CREATE POLICY request_assignee_insert ON "RequestAssignee"
  FOR INSERT WITH CHECK (
    app_external_contact_id() IS NULL
    AND app_can_access_request("serviceRequestId")
    AND app_is_staff()
  );
CREATE POLICY request_assignee_update ON "RequestAssignee"
  FOR UPDATE
  USING (
    app_external_contact_id() IS NULL
    AND app_can_access_request("serviceRequestId")
    AND app_is_staff()
  )
  WITH CHECK (
    app_external_contact_id() IS NULL
    AND app_can_access_request("serviceRequestId")
    AND app_is_staff()
  );
CREATE POLICY request_assignee_delete ON "RequestAssignee"
  FOR DELETE USING (
    app_external_contact_id() IS NULL
    AND app_can_access_request("serviceRequestId")
    AND app_is_staff()
  );


-- External contacts may only touch lastSeenAt/display profile fields.
CREATE OR REPLACE FUNCTION app_external_contact_update_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF app_external_contact_id() IS NULL OR app_is_platform_admin() OR app_is_staff() THEN
    RETURN NEW;
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW."bindingId" IS DISTINCT FROM OLD."bindingId"
     OR NEW."externalUserId" IS DISTINCT FROM OLD."externalUserId"
     OR NEW.status IS DISTINCT FROM OLD.status
     OR NEW."firstSeenAt" IS DISTINCT FROM OLD."firstSeenAt"
     OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
  THEN
    RAISE EXCEPTION 'external contact cannot modify protected contact fields'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS external_contact_update_guard ON "ExternalContact";
CREATE TRIGGER external_contact_update_guard
  BEFORE UPDATE ON "ExternalContact"
  FOR EACH ROW
  EXECUTE FUNCTION app_external_contact_update_guard();

-- External contacts may only renew or revoke their own embed sessions.
CREATE OR REPLACE FUNCTION app_external_embed_session_update_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF app_external_contact_id() IS NULL OR app_is_platform_admin() OR app_is_staff() THEN
    RETURN NEW;
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW."tokenHash" IS DISTINCT FROM OLD."tokenHash"
     OR NEW."externalContactId" IS DISTINCT FROM OLD."externalContactId"
     OR NEW."bindingId" IS DISTINCT FROM OLD."bindingId"
     OR NEW."expiresAt" IS DISTINCT FROM OLD."expiresAt"
     OR NEW."ipAddress" IS DISTINCT FROM OLD."ipAddress"
     OR NEW."userAgent" IS DISTINCT FROM OLD."userAgent"
     OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
  THEN
    RAISE EXCEPTION 'external contact cannot modify protected embed session fields'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS external_embed_session_update_guard ON "ExternalEmbedSession";
CREATE TRIGGER external_embed_session_update_guard
  BEFORE UPDATE ON "ExternalEmbedSession"
  FOR EACH ROW
  EXECUTE FUNCTION app_external_embed_session_update_guard();

GRANT EXECUTE ON FUNCTION app_external_service_request_update_guard() TO service_platform_app;
GRANT EXECUTE ON FUNCTION app_external_contact_update_guard() TO service_platform_app;
GRANT EXECUTE ON FUNCTION app_external_embed_session_update_guard() TO service_platform_app;
