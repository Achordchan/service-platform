CREATE OR REPLACE FUNCTION app_cancel_notification_mail_for_current_user(
  cancel_reason text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  target_user_id text := app_user_id();
BEGIN
  IF target_user_id IS NULL OR target_user_id = '' THEN
    RAISE EXCEPTION 'authenticated user context is required'
      USING ERRCODE = '42501';
  END IF;

  UPDATE "Notification"
  SET
    "emailDueAt" = NULL,
    "emailClaimedAt" = NULL
  WHERE "userId" = target_user_id
    AND "readAt" IS NULL;

  UPDATE "MailMessage" mail
  SET
    status = 'CANCELLED',
    "errorMessage" = cancel_reason,
    "updatedAt" = CURRENT_TIMESTAMP
  WHERE mail."sourceType" IN (
      'STANDARD_REQUEST_NOTIFICATION',
      'STANDARD_PROJECT_NOTIFICATION'
    )
    AND mail.status IN ('QUEUED', 'PROCESSING')
    AND EXISTS (
      SELECT 1
      FROM "Notification" notification
      WHERE notification.id = mail."notificationId"
        AND notification."userId" = target_user_id
    );
END;
$$;

REVOKE ALL ON FUNCTION app_cancel_notification_mail_for_current_user(text)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_cancel_notification_mail_for_current_user(text)
  TO service_platform_app;
