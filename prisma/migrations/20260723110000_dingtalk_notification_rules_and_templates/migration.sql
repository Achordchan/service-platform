ALTER TABLE "NotificationDeliveryRule"
  ADD COLUMN "dingtalkEnabled" BOOLEAN NOT NULL DEFAULT false;

DROP FUNCTION IF EXISTS app_enqueue_dingtalk_robot_delivery(
  TEXT, TEXT, TEXT, TEXT, JSONB
);

CREATE FUNCTION app_enqueue_dingtalk_robot_delivery(
  delivery_id TEXT,
  delivery_event_key TEXT,
  delivery_event_type TEXT,
  target_request_id TEXT,
  delivery_payload JSONB
)
RETURNS TABLE(
  "deliveryId" TEXT,
  outcome TEXT,
  "errorCode" TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  inserted_id TEXT;
  delivery_rule_key TEXT;
BEGIN
  delivery_rule_key := CASE delivery_event_type
    WHEN 'REQUEST_CREATED' THEN 'REQUEST_CREATED'
    WHEN 'REQUEST_CUSTOMER_REPLIED' THEN 'REQUEST_PUBLIC_MESSAGE'
    ELSE NULL
  END;

  IF delivery_rule_key IS NULL
    OR delivery_event_key IS NULL
    OR target_request_id IS NULL
    OR delivery_payload IS NULL
    OR char_length(delivery_event_key) > 300
  THEN
    RETURN QUERY SELECT NULL::TEXT, 'INVALID', NULL::TEXT;
    RETURN;
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
    RETURN QUERY SELECT NULL::TEXT, 'DENIED', NULL::TEXT;
    RETURN;
  END IF;

  IF NOT COALESCE((
    SELECT rule."dingtalkEnabled"
    FROM "NotificationDeliveryRule" rule
    WHERE rule.key = delivery_rule_key
  ), false) THEN
    RETURN QUERY SELECT NULL::TEXT, 'DISABLED', NULL::TEXT;
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM "PluginInstallation"
    WHERE key = 'dingtalk-robot'
      AND enabled = true
      AND "healthStatus" = 'READY'
      AND "healthConfigFingerprint" IS NOT NULL
      AND "secretConfigEncrypted" IS NOT NULL
  ) THEN
    RETURN QUERY SELECT NULL::TEXT, 'DISABLED', NULL::TEXT;
    RETURN;
  END IF;

  delivery_payload := delivery_payload || jsonb_build_object(
    'template',
    (
      SELECT installation.config -> 'templates' -> delivery_event_type
      FROM "PluginInstallation" installation
      WHERE installation.key = 'dingtalk-robot'
    )
  );

  IF pg_column_size(delivery_payload) > 16384 THEN
    RETURN QUERY SELECT NULL::TEXT, 'INVALID', NULL::TEXT;
    RETURN;
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
    RETURN QUERY SELECT inserted_id, 'CREATED', NULL::TEXT;
  ELSE
    RETURN QUERY SELECT NULL::TEXT, 'DUPLICATE', NULL::TEXT;
  END IF;
  RETURN;
EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT NULL::TEXT, 'ERROR', SQLSTATE::TEXT;
  RETURN;
END;
$$;

REVOKE ALL ON FUNCTION app_enqueue_dingtalk_robot_delivery(
  TEXT, TEXT, TEXT, TEXT, JSONB
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_enqueue_dingtalk_robot_delivery(
  TEXT, TEXT, TEXT, TEXT, JSONB
) TO service_platform_app;
