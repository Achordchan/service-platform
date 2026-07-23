ALTER TABLE "PluginInstallation"
  ADD COLUMN "secretConfigEncrypted" TEXT;

CREATE TABLE "DingTalkRobotDelivery" (
  id TEXT NOT NULL,
  "eventKey" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3),
  "lastAttemptAt" TIMESTAMP(3),
  "lastError" TEXT,
  "deliveredAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DingTalkRobotDelivery_pkey" PRIMARY KEY (id),
  CONSTRAINT "DingTalkRobotDelivery_requestId_fkey"
    FOREIGN KEY ("requestId") REFERENCES "ServiceRequest"(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "DingTalkRobotDelivery_status_check"
    CHECK (status IN ('PENDING', 'PROCESSING', 'DELIVERED', 'FAILED', 'SKIPPED'))
);

CREATE UNIQUE INDEX "DingTalkRobotDelivery_eventKey_key"
  ON "DingTalkRobotDelivery"("eventKey");
CREATE INDEX "DingTalkRobotDelivery_status_nextAttemptAt_idx"
  ON "DingTalkRobotDelivery"(status, "nextAttemptAt");
CREATE INDEX "DingTalkRobotDelivery_requestId_createdAt_idx"
  ON "DingTalkRobotDelivery"("requestId", "createdAt");

ALTER TABLE "DingTalkRobotDelivery" ENABLE ROW LEVEL SECURITY;

CREATE POLICY dingtalk_robot_delivery_admin_all
  ON "DingTalkRobotDelivery"
  FOR ALL
  USING (app_is_platform_admin())
  WITH CHECK (app_is_platform_admin());

GRANT SELECT, INSERT, UPDATE, DELETE ON "DingTalkRobotDelivery"
  TO service_platform_app;

CREATE OR REPLACE FUNCTION app_enqueue_dingtalk_robot_delivery(
  delivery_id TEXT,
  delivery_event_key TEXT,
  delivery_event_type TEXT,
  target_request_id TEXT,
  delivery_payload JSONB
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  inserted_id TEXT;
BEGIN
  IF delivery_event_type NOT IN ('REQUEST_CREATED', 'REQUEST_CUSTOMER_REPLIED')
    OR char_length(delivery_event_key) > 300
    OR pg_column_size(delivery_payload) > 4096
  THEN
    RETURN NULL;
  END IF;

  IF NOT (
    app_can_access_request(target_request_id)
    OR (
      app_external_contact_id() IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM "ServiceRequest" request
        WHERE request.id = target_request_id
          AND request."createdByExternalContactId" = app_external_contact_id()
          AND app_external_contact_can_access_project(request."projectId")
      )
    )
  ) THEN
    RETURN NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM "PluginInstallation"
    WHERE key = 'dingtalk-robot'
      AND enabled = true
      AND "healthStatus" = 'READY'
      AND "secretConfigEncrypted" IS NOT NULL
  ) THEN
    RETURN NULL;
  END IF;

  INSERT INTO "DingTalkRobotDelivery" (
    id,
    "eventKey",
    "eventType",
    "requestId",
    payload,
    status,
    "createdAt",
    "updatedAt"
  ) VALUES (
    delivery_id,
    delivery_event_key,
    delivery_event_type,
    target_request_id,
    delivery_payload,
    'PENDING',
    CURRENT_TIMESTAMP AT TIME ZONE 'UTC',
    CURRENT_TIMESTAMP AT TIME ZONE 'UTC'
  )
  ON CONFLICT ("eventKey") DO NOTHING
  RETURNING id INTO inserted_id;

  IF inserted_id IS NOT NULL THEN
    PERFORM pg_notify('service_platform_dingtalk_deliveries', inserted_id);
  END IF;
  RETURN inserted_id;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION app_enqueue_dingtalk_robot_delivery(
  TEXT, TEXT, TEXT, TEXT, JSONB
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_enqueue_dingtalk_robot_delivery(
  TEXT, TEXT, TEXT, TEXT, JSONB
) TO service_platform_app;
