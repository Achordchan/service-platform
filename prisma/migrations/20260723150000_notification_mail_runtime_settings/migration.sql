CREATE OR REPLACE FUNCTION app_notification_mail_runtime_settings()
RETURNS TABLE (mail_mode text, delay_enabled boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    settings."mailMode"::text,
    settings."standardRequestEmailEnabled"
  FROM "PlatformSetting" settings
  WHERE settings.id = 1
$$;

REVOKE ALL ON FUNCTION app_notification_mail_runtime_settings() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_notification_mail_runtime_settings()
  TO service_platform_app;
