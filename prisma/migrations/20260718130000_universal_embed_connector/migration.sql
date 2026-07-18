CREATE TYPE "UniversalWebhookDeliveryStatus" AS ENUM (
  'PENDING',
  'PROCESSING',
  'DELIVERED',
  'FAILED'
);

ALTER TABLE "ExternalContact"
  ADD COLUMN "avatarUrl" TEXT,
  ADD COLUMN "profileAttributes" JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE "ExternalContact"
  ADD CONSTRAINT "ExternalContact_profileAttributes_object_check"
  CHECK (jsonb_typeof("profileAttributes") = 'object');

CREATE TABLE "UniversalConnectorConnection" (
  "bindingId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "allowedOrigins" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "profileFields" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "emailNotificationsEnabled" BOOLEAN NOT NULL DEFAULT true,
  "customerMemberNotificationsEnabled" BOOLEAN NOT NULL DEFAULT false,
  "webhookUrl" TEXT,
  "webhookSecretEncrypted" TEXT,
  "webhookEvents" JSONB NOT NULL DEFAULT '["request.created","request.public_message.created","request.status.changed","request.unread.changed"]'::jsonb,
  "webhookStatus" TEXT NOT NULL DEFAULT 'DISABLED',
  "healthStatus" TEXT NOT NULL DEFAULT 'UNKNOWN',
  "lastCheckedAt" TIMESTAMP(3),
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "UniversalConnectorConnection_pkey" PRIMARY KEY ("bindingId"),
  CONSTRAINT "UniversalConnectorConnection_allowedOrigins_array_check"
    CHECK (jsonb_typeof("allowedOrigins") = 'array'),
  CONSTRAINT "UniversalConnectorConnection_profileFields_array_check"
    CHECK (
      jsonb_typeof("profileFields") = 'array'
      AND jsonb_array_length("profileFields") <= 10
    ),
  CONSTRAINT "UniversalConnectorConnection_webhookEvents_array_check"
    CHECK (jsonb_typeof("webhookEvents") = 'array')
);

CREATE TABLE "UniversalConnectorCredential" (
  "id" TEXT NOT NULL,
  "bindingId" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "secretHash" TEXT NOT NULL,
  "secretPrefix" TEXT NOT NULL,
  "lastUsedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UniversalConnectorCredential_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "UniversalLaunchTicket" (
  "id" TEXT NOT NULL,
  "bindingId" TEXT NOT NULL,
  "ticketHash" TEXT NOT NULL,
  "externalUserId" TEXT NOT NULL,
  "profile" JSONB NOT NULL,
  "context" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UniversalLaunchTicket_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "UniversalLaunchTicket_profile_object_check"
    CHECK (jsonb_typeof("profile") = 'object'),
  CONSTRAINT "UniversalLaunchTicket_context_object_check"
    CHECK (jsonb_typeof("context") = 'object'),
  CONSTRAINT "UniversalLaunchTicket_expiry_check"
    CHECK ("expiresAt" > "createdAt")
);

CREATE TABLE "UniversalWebhookDelivery" (
  "id" TEXT NOT NULL,
  "bindingId" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "status" "UniversalWebhookDeliveryStatus" NOT NULL DEFAULT 'PENDING',
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3),
  "lastAttemptAt" TIMESTAMP(3),
  "responseStatus" INTEGER,
  "lastError" TEXT,
  "deliveredAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "UniversalWebhookDelivery_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "UniversalWebhookDelivery_payload_object_check"
    CHECK (jsonb_typeof("payload") = 'object'),
  CONSTRAINT "UniversalWebhookDelivery_attempt_count_check"
    CHECK ("attemptCount" >= 0)
);

CREATE TABLE "ExternalRequestReadState" (
  "id" TEXT NOT NULL,
  "serviceRequestId" TEXT NOT NULL,
  "externalContactId" TEXT NOT NULL,
  "unreadCount" INTEGER NOT NULL DEFAULT 0,
  "lastReadAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ExternalRequestReadState_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ExternalRequestReadState_unread_count_check"
    CHECK ("unreadCount" >= 0)
);

CREATE UNIQUE INDEX "UniversalConnectorCredential_clientId_key"
  ON "UniversalConnectorCredential"("clientId");
CREATE INDEX "UniversalConnectorCredential_bindingId_revokedAt_createdAt_idx"
  ON "UniversalConnectorCredential"("bindingId", "revokedAt", "createdAt");
CREATE UNIQUE INDEX "UniversalLaunchTicket_ticketHash_key"
  ON "UniversalLaunchTicket"("ticketHash");
CREATE INDEX "UniversalLaunchTicket_bindingId_externalUserId_createdAt_idx"
  ON "UniversalLaunchTicket"("bindingId", "externalUserId", "createdAt");
CREATE INDEX "UniversalLaunchTicket_expiresAt_consumedAt_idx"
  ON "UniversalLaunchTicket"("expiresAt", "consumedAt");
CREATE UNIQUE INDEX "UniversalWebhookDelivery_eventId_key"
  ON "UniversalWebhookDelivery"("eventId");
CREATE INDEX "UniversalWebhookDelivery_bindingId_status_createdAt_idx"
  ON "UniversalWebhookDelivery"("bindingId", "status", "createdAt");
CREATE INDEX "UniversalWebhookDelivery_status_nextAttemptAt_idx"
  ON "UniversalWebhookDelivery"("status", "nextAttemptAt");
CREATE UNIQUE INDEX "ExternalRequestReadState_serviceRequestId_externalContactId_key"
  ON "ExternalRequestReadState"("serviceRequestId", "externalContactId");
CREATE INDEX "ExternalRequestReadState_externalContactId_unreadCount_updatedAt_idx"
  ON "ExternalRequestReadState"("externalContactId", "unreadCount", "updatedAt");

ALTER TABLE "UniversalConnectorConnection"
  ADD CONSTRAINT "UniversalConnectorConnection_bindingId_fkey"
  FOREIGN KEY ("bindingId") REFERENCES "ProjectPluginBinding"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UniversalConnectorCredential"
  ADD CONSTRAINT "UniversalConnectorCredential_bindingId_fkey"
  FOREIGN KEY ("bindingId") REFERENCES "UniversalConnectorConnection"("bindingId")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UniversalLaunchTicket"
  ADD CONSTRAINT "UniversalLaunchTicket_bindingId_fkey"
  FOREIGN KEY ("bindingId") REFERENCES "UniversalConnectorConnection"("bindingId")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UniversalWebhookDelivery"
  ADD CONSTRAINT "UniversalWebhookDelivery_bindingId_fkey"
  FOREIGN KEY ("bindingId") REFERENCES "UniversalConnectorConnection"("bindingId")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExternalRequestReadState"
  ADD CONSTRAINT "ExternalRequestReadState_serviceRequestId_fkey"
  FOREIGN KEY ("serviceRequestId") REFERENCES "ServiceRequest"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExternalRequestReadState"
  ADD CONSTRAINT "ExternalRequestReadState_externalContactId_fkey"
  FOREIGN KEY ("externalContactId") REFERENCES "ExternalContact"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "UniversalConnectorConnection" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "UniversalConnectorCredential" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "UniversalLaunchTicket" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "UniversalWebhookDelivery" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ExternalRequestReadState" ENABLE ROW LEVEL SECURITY;

CREATE POLICY universal_connector_connection_select
  ON "UniversalConnectorConnection"
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM "ProjectPluginBinding" binding
      WHERE binding.id = "UniversalConnectorConnection"."bindingId"
        AND app_can_access_project(binding."projectId")
    )
  );

CREATE POLICY universal_connector_connection_write
  ON "UniversalConnectorConnection"
  FOR ALL
  USING (app_is_platform_admin())
  WITH CHECK (app_is_platform_admin());

CREATE POLICY universal_connector_credential_access
  ON "UniversalConnectorCredential"
  USING (app_is_platform_admin())
  WITH CHECK (
    app_is_platform_admin()
    AND EXISTS (
      SELECT 1 FROM "ProjectPluginBinding" binding
      WHERE binding.id = "UniversalConnectorCredential"."bindingId"
        AND app_can_access_project(binding."projectId")
    )
  );

CREATE OR REPLACE FUNCTION app_count_active_universal_credentials(
  p_binding_id TEXT
)
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COUNT(*)::INTEGER
  FROM "UniversalConnectorCredential" credential
  JOIN "ProjectPluginBinding" binding
    ON binding.id = credential."bindingId"
  WHERE credential."bindingId" = p_binding_id
    AND credential."revokedAt" IS NULL
    AND app_can_access_project(binding."projectId")
$$;

REVOKE ALL ON FUNCTION app_count_active_universal_credentials(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_count_active_universal_credentials(TEXT)
  TO service_platform_app;

CREATE POLICY universal_launch_ticket_admin_access
  ON "UniversalLaunchTicket"
  USING (app_is_platform_admin())
  WITH CHECK (app_is_platform_admin());

CREATE POLICY universal_webhook_delivery_select
  ON "UniversalWebhookDelivery"
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM "ProjectPluginBinding" binding
      WHERE binding.id = "UniversalWebhookDelivery"."bindingId"
        AND app_can_access_project(binding."projectId")
    )
  );

CREATE POLICY universal_webhook_delivery_write
  ON "UniversalWebhookDelivery"
  FOR ALL
  USING (app_is_platform_admin())
  WITH CHECK (app_is_platform_admin());

CREATE POLICY external_request_read_state_access
  ON "ExternalRequestReadState"
  USING (app_can_access_request("serviceRequestId"))
  WITH CHECK (
    app_can_access_request("serviceRequestId")
    AND (
      "externalContactId" = app_external_contact_id()
      OR app_is_staff()
      OR app_is_platform_admin()
    )
  );

CREATE OR REPLACE FUNCTION app_enqueue_universal_webhook(
  p_delivery_id TEXT,
  p_service_request_id TEXT,
  p_event_id TEXT,
  p_event_type TEXT,
  p_payload JSONB
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  target_binding_id TEXT;
  delivery_id TEXT;
BEGIN
  SELECT connection."bindingId"
    INTO target_binding_id
  FROM "ServiceRequest" request
  JOIN "ExternalContact" contact
    ON contact.id = request."createdByExternalContactId"
  JOIN "ProjectPluginBinding" binding
    ON binding.id = contact."bindingId"
  JOIN "PluginInstallation" plugin
    ON plugin.key = binding."pluginKey"
  JOIN "UniversalConnectorConnection" connection
    ON connection."bindingId" = binding.id
  WHERE request.id = p_service_request_id
    AND binding."pluginKey" = 'universal-embed-connector'
    AND binding.status = 'ACTIVE'
    AND plugin.enabled = true
    AND plugin."healthStatus" = 'READY'
    AND connection."webhookUrl" IS NOT NULL
    AND connection."webhookSecretEncrypted" IS NOT NULL
    AND connection."webhookEvents" ? p_event_type;

  IF target_binding_id IS NULL THEN
    RETURN NULL;
  END IF;

  delivery_id := p_delivery_id;
  INSERT INTO "UniversalWebhookDelivery" (
    id,
    "bindingId",
    "eventId",
    "eventType",
    payload,
    status,
    "attemptCount",
    "createdAt",
    "updatedAt"
  ) VALUES (
    delivery_id,
    target_binding_id,
    p_event_id,
    p_event_type,
    p_payload,
    'PENDING',
    0,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  )
  ON CONFLICT ("eventId") DO NOTHING;

  IF NOT FOUND THEN
    SELECT id INTO delivery_id
    FROM "UniversalWebhookDelivery"
    WHERE "eventId" = p_event_id;
  END IF;

  PERFORM pg_notify('service_platform_webhook_deliveries', delivery_id);
  RETURN delivery_id;
END;
$$;

REVOKE ALL ON FUNCTION app_enqueue_universal_webhook(TEXT, TEXT, TEXT, TEXT, JSONB)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_enqueue_universal_webhook(TEXT, TEXT, TEXT, TEXT, JSONB)
  TO service_platform_app;

GRANT SELECT, INSERT, UPDATE, DELETE ON "UniversalConnectorConnection"
  TO service_platform_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "UniversalConnectorCredential"
  TO service_platform_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "UniversalLaunchTicket"
  TO service_platform_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "UniversalWebhookDelivery"
  TO service_platform_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "ExternalRequestReadState"
  TO service_platform_app;
