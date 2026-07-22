CREATE OR REPLACE FUNCTION app_upsert_request_notification(
  notification_id text,
  notification_type text,
  notification_title text,
  notification_body text,
  recipient_user_id text,
  target_customer_space_id text,
  target_project_id text,
  target_service_request_id text,
  target_aggregation_key text,
  target_email_due_at timestamp without time zone
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
    "emailDueAt",
    "emailClaimedAt",
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
    target_email_due_at,
    NULL,
    recipient_user_id,
    target_customer_space_id,
    target_project_id,
    target_service_request_id,
    CURRENT_TIMESTAMP AT TIME ZONE 'UTC',
    CURRENT_TIMESTAMP AT TIME ZONE 'UTC'
  )
  ON CONFLICT ("userId", "aggregationKey")
  DO UPDATE SET
    type = EXCLUDED.type,
    title = EXCLUDED.title,
    body = EXCLUDED.body,
    "readAt" = NULL,
    "occurrenceCount" = "Notification"."occurrenceCount" + 1,
    "emailDueAt" = EXCLUDED."emailDueAt",
    "emailClaimedAt" = NULL,
    "customerSpaceId" = EXCLUDED."customerSpaceId",
    "projectId" = EXCLUDED."projectId",
    "serviceRequestId" = EXCLUDED."serviceRequestId",
    "updatedAt" = CURRENT_TIMESTAMP AT TIME ZONE 'UTC'
  RETURNING
    "Notification".id,
    "Notification"."occurrenceCount";
END;
$$;

GRANT EXECUTE ON FUNCTION app_upsert_request_notification(
  text, text, text, text, text, text, text, text, text, timestamp without time zone
) TO service_platform_app;
