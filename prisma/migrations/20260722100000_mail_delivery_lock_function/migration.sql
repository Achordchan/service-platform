CREATE OR REPLACE FUNCTION app_lock_mail_delivery_settings()
RETURNS TABLE (
  "mailMode" "MailDeliveryMode",
  "resendReady" boolean,
  "smtpHostConfigured" boolean,
  "smtpPortConfigured" boolean,
  "smtpUserConfigured" boolean,
  "smtpPasswordConfigured" boolean,
  "smtpFromConfigured" boolean,
  "smtpHealthStatus" text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    settings."mailMode",
    (
      settings."resendApiKeyEncrypted" IS NOT NULL
      AND settings."resendDomainStatus" = 'verified'
      AND settings."resendWebhookId" IS NOT NULL
      AND settings."resendWebhookStatus" = 'enabled'
      AND settings."resendWebhookSecretEncrypted" IS NOT NULL
    ) AS "resendReady",
    settings."smtpHost" IS NOT NULL AS "smtpHostConfigured",
    settings."smtpPort" IS NOT NULL AS "smtpPortConfigured",
    settings."smtpUser" IS NOT NULL AS "smtpUserConfigured",
    (
      settings."smtpPasswordEncrypted" IS NOT NULL
      OR settings."smtpPassword" IS NOT NULL
    ) AS "smtpPasswordConfigured",
    settings."smtpFrom" IS NOT NULL AS "smtpFromConfigured",
    settings."smtpHealthStatus"
  FROM "PlatformSetting" settings
  WHERE settings.id = 1
  FOR UPDATE
$$;

REVOKE ALL ON FUNCTION app_lock_mail_delivery_settings() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_lock_mail_delivery_settings()
  TO service_platform_app;
