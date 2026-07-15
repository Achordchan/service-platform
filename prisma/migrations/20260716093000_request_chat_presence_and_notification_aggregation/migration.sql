ALTER TYPE "EventType" ADD VALUE IF NOT EXISTS 'REQUEST_PRESENCE_CHANGED';

ALTER TABLE "RequestMessage"
  ADD COLUMN "isInitial" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "replyToMessageId" TEXT;

CREATE INDEX "RequestMessage_replyToMessageId_idx"
  ON "RequestMessage"("replyToMessageId");

ALTER TABLE "RequestMessage"
  ADD CONSTRAINT "RequestMessage_replyToMessageId_fkey"
  FOREIGN KEY ("replyToMessageId")
  REFERENCES "RequestMessage"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;

ALTER TABLE "Notification"
  ADD COLUMN "aggregationKey" TEXT,
  ADD COLUMN "occurrenceCount" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE "Notification"
SET "updatedAt" = "createdAt";

WITH ranked AS (
  SELECT
    id,
    "userId",
    "serviceRequestId",
    ROW_NUMBER() OVER (
      PARTITION BY "userId", "serviceRequestId"
      ORDER BY "createdAt" DESC, id DESC
    ) AS row_number,
    COUNT(*) OVER (
      PARTITION BY "userId", "serviceRequestId"
    )::integer AS occurrence_count,
    BOOL_OR("readAt" IS NULL) OVER (
      PARTITION BY "userId", "serviceRequestId"
    ) AS has_unread
  FROM "Notification"
  WHERE "serviceRequestId" IS NOT NULL
)
UPDATE "Notification" notification
SET
  "occurrenceCount" = ranked.occurrence_count,
  "readAt" = CASE
    WHEN ranked.has_unread THEN NULL
    ELSE notification."readAt"
  END,
  "aggregationKey" = CASE
    WHEN ranked.has_unread
      THEN 'request:' || notification."serviceRequestId"
    ELSE NULL
  END
FROM ranked
WHERE notification.id = ranked.id
  AND ranked.row_number = 1;

WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY "userId", "serviceRequestId"
      ORDER BY "createdAt" DESC, id DESC
    ) AS row_number
  FROM "Notification"
  WHERE "serviceRequestId" IS NOT NULL
)
DELETE FROM "Notification" notification
USING ranked
WHERE notification.id = ranked.id
  AND ranked.row_number > 1;

CREATE UNIQUE INDEX "Notification_userId_aggregationKey_key"
  ON "Notification"("userId", "aggregationKey");

CREATE TABLE "RequestPresence" (
  "id" TEXT NOT NULL,
  "serviceRequestId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "RequestPresence_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RequestPresence_serviceRequestId_userId_sessionId_key"
  ON "RequestPresence"("serviceRequestId", "userId", "sessionId");
CREATE INDEX "RequestPresence_serviceRequestId_expiresAt_idx"
  ON "RequestPresence"("serviceRequestId", "expiresAt");
CREATE INDEX "RequestPresence_userId_expiresAt_idx"
  ON "RequestPresence"("userId", "expiresAt");

ALTER TABLE "RequestPresence"
  ADD CONSTRAINT "RequestPresence_serviceRequestId_fkey"
  FOREIGN KEY ("serviceRequestId")
  REFERENCES "ServiceRequest"("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;

ALTER TABLE "RequestPresence"
  ADD CONSTRAINT "RequestPresence_userId_fkey"
  FOREIGN KEY ("userId")
  REFERENCES "User"("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;

ALTER TABLE "RequestPresence" ENABLE ROW LEVEL SECURITY;

CREATE POLICY request_presence_select ON "RequestPresence"
  FOR SELECT
  USING (app_can_access_request("serviceRequestId"));

CREATE POLICY request_presence_insert ON "RequestPresence"
  FOR INSERT
  WITH CHECK (
    app_can_access_request("serviceRequestId")
    AND "userId" = app_user_id()
  );

CREATE POLICY request_presence_update ON "RequestPresence"
  FOR UPDATE
  USING (
    app_can_access_request("serviceRequestId")
    AND "userId" = app_user_id()
  )
  WITH CHECK (
    app_can_access_request("serviceRequestId")
    AND "userId" = app_user_id()
  );

CREATE POLICY request_presence_delete ON "RequestPresence"
  FOR DELETE
  USING (
    app_can_access_request("serviceRequestId")
    AND "userId" = app_user_id()
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON "RequestPresence"
  TO service_platform_app;

CREATE OR REPLACE FUNCTION app_can_access_request_row(
  target_request_id text,
  target_project_id text,
  target_assignee_id text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    app_can_access_request_fields(target_project_id, target_assignee_id)
    OR EXISTS (
      SELECT 1
      FROM "RequestAssignee" assignee
      WHERE assignee."serviceRequestId" = target_request_id
        AND assignee."userId" = app_user_id()
    )
    OR (
      target_assignee_id IS NULL
      AND NOT EXISTS (
        SELECT 1
        FROM "RequestAssignee" assignee
        WHERE assignee."serviceRequestId" = target_request_id
      )
      AND EXISTS (
        SELECT 1
        FROM "ProjectStaff" staff
        WHERE staff."projectId" = target_project_id
          AND staff."userId" = app_user_id()
      )
    );
$$;

GRANT EXECUTE ON FUNCTION app_can_access_request_row(text, text, text)
  TO service_platform_app;

CREATE OR REPLACE FUNCTION app_upsert_request_notification(
  notification_id text,
  notification_type text,
  notification_title text,
  notification_body text,
  recipient_user_id text,
  target_customer_space_id text,
  target_project_id text,
  target_service_request_id text,
  target_aggregation_key text
)
RETURNS TABLE(id text, occurrence_count integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT app_can_access_request(target_service_request_id)
    OR NOT app_user_relevant_to_project(
      recipient_user_id,
      target_project_id
    )
  THEN
    RAISE EXCEPTION 'request notification scope denied';
  END IF;

  RETURN QUERY
  INSERT INTO "Notification" (
    id,
    type,
    title,
    body,
    "readAt",
    "aggregationKey",
    "occurrenceCount",
    "userId",
    "customerSpaceId",
    "projectId",
    "serviceRequestId",
    "createdAt",
    "updatedAt"
  )
  VALUES (
    notification_id,
    notification_type::"NotificationType",
    notification_title,
    notification_body,
    NULL,
    target_aggregation_key,
    1,
    recipient_user_id,
    target_customer_space_id,
    target_project_id,
    target_service_request_id,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  )
  ON CONFLICT ("userId", "aggregationKey")
  DO UPDATE SET
    type = EXCLUDED.type,
    title = EXCLUDED.title,
    body = EXCLUDED.body,
    "readAt" = NULL,
    "occurrenceCount" = "Notification"."occurrenceCount" + 1,
    "customerSpaceId" = EXCLUDED."customerSpaceId",
    "projectId" = EXCLUDED."projectId",
    "serviceRequestId" = EXCLUDED."serviceRequestId",
    "updatedAt" = CURRENT_TIMESTAMP
  RETURNING
    "Notification".id,
    "Notification"."occurrenceCount";
END;
$$;

GRANT EXECUTE ON FUNCTION app_upsert_request_notification(
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text
) TO service_platform_app;

INSERT INTO "RequestMessage" (
  id,
  body,
  visibility,
  "isSystem",
  "isInitial",
  "serviceRequestId",
  "authorId",
  "createdAt",
  "updatedAt"
)
SELECT
  '000_initial_' || request.id,
  '<h3>' ||
    replace(
      replace(
        replace(
          replace(
            replace(request.title, '&', '&amp;'),
            '<',
            '&lt;'
          ),
          '>',
          '&gt;'
        ),
        '"',
        '&quot;'
      ),
      '''',
      '&#39;'
    ) ||
    '</h3>' ||
    request.description,
  'CUSTOMER_VISIBLE'::"ContentVisibility",
  false,
  true,
  request.id,
  request."createdById",
  request."createdAt",
  request."createdAt"
FROM "ServiceRequest" request
WHERE NOT EXISTS (
  SELECT 1
  FROM "RequestMessage" message
  WHERE message."serviceRequestId" = request.id
    AND message."isInitial" = true
)
ON CONFLICT (id) DO NOTHING;

UPDATE "Attachment" attachment
SET "requestMessageId" = initial_message.id
FROM "RequestMessage" initial_message
WHERE attachment."serviceRequestId" = initial_message."serviceRequestId"
  AND attachment."requestMessageId" IS NULL
  AND initial_message."isInitial" = true;

DELETE FROM "RequestMessage"
WHERE "isSystem" = true
  AND body NOT LIKE '%已接手此请求%';
