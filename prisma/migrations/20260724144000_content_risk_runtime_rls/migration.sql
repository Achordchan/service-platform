CREATE OR REPLACE FUNCTION app_get_content_risk_runtime()
RETURNS TABLE (
  "activationId" TEXT,
  "enabledAt" TIMESTAMP WITHOUT TIME ZONE,
  model TEXT,
  "fullAuditEnabled" BOOLEAN,
  "allowedDomains" JSONB
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    runtime."activationId",
    runtime."enabledAt",
    COALESCE(installation.config ->> 'model', ''),
    COALESCE((installation.config ->> 'fullAuditEnabled')::BOOLEAN, TRUE),
    COALESCE(installation.config -> 'allowedDomains', '[]'::JSONB)
  FROM "PluginInstallation" installation
  JOIN "ContentRiskRuntimeState" runtime
    ON runtime."pluginKey" = installation.key
  WHERE installation.key = 'content-contact-risk'
    AND installation.enabled = TRUE
    AND installation."healthStatus" = 'READY'
    AND runtime."bypassedAt" IS NULL
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION app_get_content_risk_runtime() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_get_content_risk_runtime()
  TO service_platform_app;
