ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'CONTENT_RISK';
ALTER TYPE "EventType" ADD VALUE IF NOT EXISTS 'CONTENT_RISK_DETECTED';
ALTER TYPE "EventType" ADD VALUE IF NOT EXISTS 'CONTENT_RISK_REVIEW_UPDATED';
ALTER TYPE "EventType" ADD VALUE IF NOT EXISTS 'CONTENT_RISK_PLUGIN_FAILED';

CREATE TYPE "ContentRiskTargetType" AS ENUM (
  'SERVICE_REQUEST',
  'REQUEST_MESSAGE',
  'PROJECT_UPDATE',
  'UPDATE_COMMENT',
  'MILESTONE',
  'ATTACHMENT'
);

CREATE TYPE "ContentRiskReviewStatus" AS ENUM (
  'QUEUED',
  'PROCESSING',
  'PASSED',
  'VIOLATION',
  'UNCERTAIN',
  'SKIPPED_UNSUPPORTED',
  'CANCELLED',
  'FAILED'
);

CREATE TYPE "ContentRiskDecisionSource" AS ENUM ('RULE', 'AI');
CREATE TYPE "ContentRiskDisplayState" AS ENUM ('VISIBLE', 'REVOKED');

ALTER TABLE "Notification"
  ADD COLUMN "contentRiskReviewId" TEXT,
  ADD COLUMN "contentRiskEmailDueAt" TIMESTAMP(3),
  ADD COLUMN "contentRiskReadAtBeforeSuppression" TIMESTAMP(3),
  ADD COLUMN "contentRiskBodyBeforeSuppression" TEXT,
  ADD COLUMN "contentRiskSuppressed" BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE "MailMessage"
  ADD COLUMN "contentRiskReviewId" TEXT;

ALTER TABLE "DingTalkRobotDelivery"
  ADD COLUMN "contentRiskReviewId" TEXT,
  ALTER COLUMN "requestId" DROP NOT NULL;

ALTER TABLE "DingTalkRobotDelivery"
  DROP CONSTRAINT IF EXISTS "DingTalkRobotDelivery_status_check",
  ADD CONSTRAINT "DingTalkRobotDelivery_status_check"
    CHECK (status IN ('PENDING', 'HELD', 'PROCESSING', 'DELIVERED', 'FAILED', 'SKIPPED'));

CREATE TABLE "ContentRiskRuntimeState" (
  "pluginKey" TEXT NOT NULL,
  "activationId" TEXT NOT NULL,
  "enabledAt" TIMESTAMP(3) NOT NULL,
  "bypassedAt" TIMESTAMP(3),
  "capabilityReport" JSONB,
  "unsupportedNotified" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ContentRiskRuntimeState_pkey" PRIMARY KEY ("pluginKey")
);

CREATE TABLE "ContentRiskState" (
  "id" TEXT NOT NULL,
  "targetType" "ContentRiskTargetType" NOT NULL,
  "targetId" TEXT NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "approvedRevision" INTEGER NOT NULL DEFAULT 0,
  "displayState" "ContentRiskDisplayState" NOT NULL DEFAULT 'VISIBLE',
  "latestReviewId" TEXT,
  "lastApprovedSnapshotEncrypted" TEXT,
  "revokedAt" TIMESTAMP(3),
  "restoredAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ContentRiskState_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ContentRiskReview" (
  "id" TEXT NOT NULL,
  "activationId" TEXT NOT NULL,
  "targetType" "ContentRiskTargetType" NOT NULL,
  "targetId" TEXT NOT NULL,
  "revision" INTEGER NOT NULL,
  "actorId" TEXT,
  "customerSpaceId" TEXT,
  "projectId" TEXT,
  "serviceRequestId" TEXT,
  "source" "ContentRiskDecisionSource" NOT NULL,
  "status" "ContentRiskReviewStatus" NOT NULL DEFAULT 'QUEUED',
  "decision" TEXT,
  "riskCategories" JSONB,
  "decisionReason" TEXT,
  "actorName" TEXT,
  "contentSnapshotEncrypted" TEXT NOT NULL,
  "previousSnapshotEncrypted" TEXT,
  "providerModel" TEXT,
  "providerRequestId" TEXT,
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3),
  "lastAttemptAt" TIMESTAMP(3),
  "lastError" TEXT,
  "completedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "restoredAt" TIMESTAMP(3),
  "restoredById" TEXT,
  "restoreReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ContentRiskReview_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ContentRiskState_targetType_targetId_key"
  ON "ContentRiskState"("targetType", "targetId");
CREATE INDEX "ContentRiskState_latestReviewId_idx"
  ON "ContentRiskState"("latestReviewId");
CREATE INDEX "ContentRiskState_displayState_updatedAt_idx"
  ON "ContentRiskState"("displayState", "updatedAt");
CREATE UNIQUE INDEX "ContentRiskReview_activationId_targetType_targetId_revision_key"
  ON "ContentRiskReview"("activationId", "targetType", "targetId", "revision");
CREATE INDEX "ContentRiskReview_status_nextAttemptAt_createdAt_idx"
  ON "ContentRiskReview"("status", "nextAttemptAt", "createdAt");
CREATE INDEX "ContentRiskReview_targetType_targetId_createdAt_idx"
  ON "ContentRiskReview"("targetType", "targetId", "createdAt");
CREATE INDEX "ContentRiskReview_actorId_createdAt_idx"
  ON "ContentRiskReview"("actorId", "createdAt");
CREATE INDEX "ContentRiskReview_projectId_createdAt_idx"
  ON "ContentRiskReview"("projectId", "createdAt");
CREATE INDEX "ContentRiskReview_serviceRequestId_createdAt_idx"
  ON "ContentRiskReview"("serviceRequestId", "createdAt");
CREATE INDEX "ContentRiskRuntimeState_activationId_idx"
  ON "ContentRiskRuntimeState"("activationId");
CREATE INDEX "Notification_contentRiskReviewId_idx"
  ON "Notification"("contentRiskReviewId");
CREATE INDEX "DingTalkRobotDelivery_contentRiskReviewId_idx"
  ON "DingTalkRobotDelivery"("contentRiskReviewId");
CREATE INDEX "MailMessage_contentRiskReviewId_idx"
  ON "MailMessage"("contentRiskReviewId");

GRANT SELECT, INSERT, UPDATE, DELETE ON "ContentRiskRuntimeState"
  TO service_platform_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "ContentRiskState"
  TO service_platform_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "ContentRiskReview"
  TO service_platform_app;

CREATE OR REPLACE FUNCTION app_can_access_content_risk_target(
  target_type TEXT,
  target_id TEXT
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT app_is_platform_admin() OR CASE target_type
    WHEN 'SERVICE_REQUEST' THEN EXISTS (
      SELECT 1
      FROM "ServiceRequest" request
      WHERE request.id = target_id
        AND (
          app_can_access_request(request.id)
          OR (
            app_external_contact_id() IS NOT NULL
            AND request."createdByExternalContactId" = app_external_contact_id()
            AND app_external_contact_can_access_project(request."projectId")
          )
        )
    )
    WHEN 'REQUEST_MESSAGE' THEN EXISTS (
      SELECT 1
      FROM "RequestMessage" message
      JOIN "ServiceRequest" request ON request.id = message."serviceRequestId"
      WHERE message.id = target_id
        AND (
          app_can_access_request(request.id)
          OR (
            app_external_contact_id() IS NOT NULL
            AND request."createdByExternalContactId" = app_external_contact_id()
            AND app_external_contact_can_access_project(request."projectId")
          )
        )
    )
    WHEN 'PROJECT_UPDATE' THEN EXISTS (
      SELECT 1 FROM "ProjectUpdate" item
      WHERE item.id = target_id AND app_can_access_project(item."projectId")
    )
    WHEN 'UPDATE_COMMENT' THEN EXISTS (
      SELECT 1
      FROM "UpdateComment" comment
      JOIN "ProjectUpdate" item ON item.id = comment."projectUpdateId"
      WHERE comment.id = target_id AND app_can_access_project(item."projectId")
    )
    WHEN 'MILESTONE' THEN EXISTS (
      SELECT 1 FROM "Milestone" item
      WHERE item.id = target_id AND app_can_access_project(item."projectId")
    )
    WHEN 'ATTACHMENT' THEN EXISTS (
      SELECT 1
      FROM "Attachment" attachment
      LEFT JOIN "RequestMessage" message ON message.id = attachment."requestMessageId"
      LEFT JOIN "ServiceRequest" request ON request.id = COALESCE(
        attachment."serviceRequestId",
        message."serviceRequestId"
      )
      LEFT JOIN "ProjectUpdate" project_update ON project_update.id = attachment."projectUpdateId"
      LEFT JOIN "UpdateComment" update_comment ON update_comment.id = attachment."updateCommentId"
      LEFT JOIN "ProjectUpdate" comment_update ON comment_update.id = update_comment."projectUpdateId"
      LEFT JOIN "Milestone" milestone ON milestone.id = attachment."milestoneId"
      WHERE attachment.id = target_id
        AND (
          (
            request.id IS NOT NULL
            AND (
              app_can_access_request(request.id)
              OR (
                app_external_contact_id() IS NOT NULL
                AND request."createdByExternalContactId" = app_external_contact_id()
                AND app_external_contact_can_access_project(request."projectId")
              )
            )
          )
          OR (project_update.id IS NOT NULL AND app_can_access_project(project_update."projectId"))
          OR (comment_update.id IS NOT NULL AND app_can_access_project(comment_update."projectId"))
          OR (milestone.id IS NOT NULL AND app_can_access_project(milestone."projectId"))
        )
    )
    ELSE FALSE
  END;
$$;

REVOKE ALL ON FUNCTION app_can_access_content_risk_target(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_can_access_content_risk_target(TEXT, TEXT)
  TO service_platform_app;

ALTER TABLE "ContentRiskRuntimeState" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ContentRiskState" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ContentRiskReview" ENABLE ROW LEVEL SECURITY;

CREATE POLICY content_risk_runtime_read ON "ContentRiskRuntimeState"
  FOR SELECT USING (TRUE);
CREATE POLICY content_risk_runtime_admin_write ON "ContentRiskRuntimeState"
  FOR ALL USING (app_is_platform_admin()) WITH CHECK (app_is_platform_admin());

CREATE POLICY content_risk_state_access ON "ContentRiskState"
  FOR ALL
  USING (app_can_access_content_risk_target("targetType"::TEXT, "targetId"))
  WITH CHECK (app_can_access_content_risk_target("targetType"::TEXT, "targetId"));

CREATE POLICY content_risk_review_read ON "ContentRiskReview"
  FOR SELECT USING (
    app_is_platform_admin()
    OR "actorId" = app_user_id()
    OR "actorId" = app_external_contact_id()
    OR app_can_access_content_risk_target("targetType"::TEXT, "targetId")
  );
CREATE POLICY content_risk_review_insert ON "ContentRiskReview"
  FOR INSERT WITH CHECK (
    app_is_platform_admin()
    OR (
      ("actorId" = app_user_id() OR "actorId" = app_external_contact_id())
      AND app_can_access_content_risk_target("targetType"::TEXT, "targetId")
    )
  );
CREATE POLICY content_risk_review_admin_update ON "ContentRiskReview"
  FOR UPDATE USING (app_is_platform_admin()) WITH CHECK (app_is_platform_admin());
CREATE POLICY content_risk_review_admin_delete ON "ContentRiskReview"
  FOR DELETE USING (app_is_platform_admin());

CREATE OR REPLACE FUNCTION app_hold_notification_for_content_risk(
  target_notification_id TEXT,
  target_review_id TEXT,
  target_email_due_at TIMESTAMP WITHOUT TIME ZONE
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "ContentRiskReview" review
    JOIN "Notification" notification ON notification.id = target_notification_id
    WHERE review.id = target_review_id
      AND app_can_access_content_risk_target(review."targetType"::TEXT, review."targetId")
      AND notification."customerSpaceId" IS NOT DISTINCT FROM review."customerSpaceId"
      AND notification."projectId" IS NOT DISTINCT FROM review."projectId"
      AND notification."serviceRequestId" IS NOT DISTINCT FROM review."serviceRequestId"
  ) THEN
    RETURN FALSE;
  END IF;

  UPDATE "Notification"
  SET "contentRiskReviewId" = target_review_id,
      "contentRiskEmailDueAt" = target_email_due_at,
      "emailDueAt" = NULL,
      "emailClaimedAt" = NULL
  WHERE id = target_notification_id;
  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION app_hold_notification_for_content_risk(
  TEXT, TEXT, TIMESTAMP WITHOUT TIME ZONE
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_hold_notification_for_content_risk(
  TEXT, TEXT, TIMESTAMP WITHOUT TIME ZONE
) TO service_platform_app;

CREATE OR REPLACE FUNCTION app_hold_dingtalk_delivery_for_content_risk(
  target_delivery_id TEXT,
  target_review_id TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "ContentRiskReview" review
    JOIN "DingTalkRobotDelivery" delivery ON delivery.id = target_delivery_id
    WHERE review.id = target_review_id
      AND app_can_access_content_risk_target(review."targetType"::TEXT, review."targetId")
      AND delivery."requestId" IS NOT DISTINCT FROM review."serviceRequestId"
  ) THEN
    RETURN FALSE;
  END IF;

  UPDATE "DingTalkRobotDelivery"
  SET "contentRiskReviewId" = target_review_id,
      status = 'HELD',
      "nextAttemptAt" = NULL,
      "updatedAt" = CURRENT_TIMESTAMP
  WHERE id = target_delivery_id;
  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION app_hold_dingtalk_delivery_for_content_risk(TEXT, TEXT)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_hold_dingtalk_delivery_for_content_risk(TEXT, TEXT)
  TO service_platform_app;

CREATE OR REPLACE FUNCTION app_cancel_superseded_content_risk_review(
  target_review_id TEXT,
  cancellation_reason TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  cancellation_time TIMESTAMP(3) := CURRENT_TIMESTAMP;
BEGIN
  IF cancellation_reason IS NULL
    OR char_length(cancellation_reason) < 2
    OR char_length(cancellation_reason) > 500
    OR NOT EXISTS (
      SELECT 1
      FROM "ContentRiskReview" review
      WHERE review.id = target_review_id
        AND app_can_access_content_risk_target(
          review."targetType"::TEXT,
          review."targetId"
        )
    )
  THEN
    RETURN FALSE;
  END IF;

  UPDATE "ContentRiskReview"
  SET status = 'CANCELLED',
      "completedAt" = cancellation_time,
      "nextAttemptAt" = NULL,
      "lastError" = cancellation_reason,
      "updatedAt" = cancellation_time
  WHERE id = target_review_id
    AND status IN ('QUEUED', 'PROCESSING');

  UPDATE "Notification"
  SET "readAt" = cancellation_time,
      body = '相关内容已被系统撤回',
      "aggregationKey" = NULL,
      "emailDueAt" = NULL,
      "emailClaimedAt" = NULL,
      "contentRiskReviewId" = NULL,
      "contentRiskEmailDueAt" = NULL,
      "contentRiskReadAtBeforeSuppression" = NULL,
      "contentRiskBodyBeforeSuppression" = NULL,
      "contentRiskSuppressed" = FALSE,
      "updatedAt" = cancellation_time
  WHERE "contentRiskReviewId" = target_review_id;

  UPDATE "MailMessage"
  SET "contentRiskReviewId" = NULL,
      status = 'CANCELLED',
      "errorMessage" = cancellation_reason,
      "updatedAt" = cancellation_time
  WHERE "contentRiskReviewId" = target_review_id
    AND status IN ('QUEUED', 'PROCESSING');

  UPDATE "DingTalkRobotDelivery"
  SET "contentRiskReviewId" = NULL,
      status = 'SKIPPED',
      "nextAttemptAt" = NULL,
      "lastError" = cancellation_reason,
      "updatedAt" = cancellation_time
  WHERE "contentRiskReviewId" = target_review_id
    AND status IN ('HELD', 'PENDING', 'PROCESSING');

  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION app_cancel_superseded_content_risk_review(TEXT, TEXT)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_cancel_superseded_content_risk_review(TEXT, TEXT)
  TO service_platform_app;

INSERT INTO "NotificationDeliveryRule" (
  "key", "notificationEnabled", "soundEnabled", "emailEnabled", "dingtalkEnabled", "updatedAt"
) VALUES (
  'CONTENT_RISK_ALERT', TRUE, TRUE, TRUE, TRUE, CURRENT_TIMESTAMP
) ON CONFLICT ("key") DO NOTHING;

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
    WHEN 'CONTENT_RISK_ALERT' THEN 'CONTENT_RISK_ALERT'
    ELSE NULL
  END;

  IF delivery_rule_key IS NULL
    OR delivery_event_key IS NULL
    OR delivery_payload IS NULL
    OR char_length(delivery_event_key) > 300
    OR (delivery_event_type <> 'CONTENT_RISK_ALERT' AND target_request_id IS NULL)
  THEN
    RETURN QUERY SELECT NULL::TEXT, 'INVALID', NULL::TEXT;
    RETURN;
  END IF;

  IF delivery_event_type <> 'CONTENT_RISK_ALERT' AND NOT (
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
