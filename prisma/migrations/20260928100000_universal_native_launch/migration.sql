-- Achord Connect Native Launch：原生 App 由后端签票后在自己的窗口 / 系统浏览器 /
-- WebView 中顶层打开门户，不经过 iframe，也就拿不到父页面 Origin。
-- 是否跳过父页面来源校验只看票据上存的 launchMode，前端传什么都不作数。

ALTER TABLE "UniversalConnectorConnection"
  ADD COLUMN "allowNativeLaunch" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "UniversalLaunchTicket"
  ADD COLUMN "launchMode" TEXT NOT NULL DEFAULT 'iframe';
ALTER TABLE "UniversalLaunchTicket"
  ADD CONSTRAINT "UniversalLaunchTicket_launchMode_check"
  CHECK ("launchMode" IN ('iframe', 'native'));

ALTER TABLE "ExternalEmbedSession"
  ADD COLUMN "launchMode" TEXT NOT NULL DEFAULT 'iframe';
ALTER TABLE "ExternalEmbedSession"
  ADD CONSTRAINT "ExternalEmbedSession_launchMode_check"
  CHECK ("launchMode" IN ('iframe', 'native'));

-- 外部联系人续期 / 撤销自己的会话时同样不能改 launchMode
CREATE OR REPLACE FUNCTION app_external_embed_session_update_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF app_external_contact_id() IS NULL OR app_is_platform_admin() OR app_is_staff() THEN
    RETURN NEW;
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW."tokenHash" IS DISTINCT FROM OLD."tokenHash"
     OR NEW."externalContactId" IS DISTINCT FROM OLD."externalContactId"
     OR NEW."bindingId" IS DISTINCT FROM OLD."bindingId"
     OR NEW."expiresAt" IS DISTINCT FROM OLD."expiresAt"
     OR NEW."ipAddress" IS DISTINCT FROM OLD."ipAddress"
     OR NEW."userAgent" IS DISTINCT FROM OLD."userAgent"
     OR NEW."launchMode" IS DISTINCT FROM OLD."launchMode"
     OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
  THEN
    RAISE EXCEPTION 'external contact cannot modify protected embed session fields'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

-- 员工端连接详情里的「最近会话」。会话表 SELECT 只放行平台管理员和联系人本人，
-- 这里按项目访问权放行员工只读最近 10 条，不含令牌摘要。
CREATE OR REPLACE FUNCTION app_universal_recent_embed_sessions(p_binding_id text)
RETURNS TABLE (
  session_id text,
  contact_id text,
  contact_name text,
  external_user_id text,
  launch_mode text,
  created_at timestamp(3),
  last_seen_at timestamp(3),
  expires_at timestamp(3),
  revoked_at timestamp(3)
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    session.id,
    contact.id,
    contact."displayName",
    contact."externalUserId",
    session."launchMode",
    session."createdAt",
    session."lastSeenAt",
    session."expiresAt",
    session."revokedAt"
  FROM "ExternalEmbedSession" session
  JOIN "ExternalContact" contact ON contact.id = session."externalContactId"
  JOIN "ProjectPluginBinding" binding ON binding.id = session."bindingId"
  WHERE session."bindingId" = p_binding_id
    AND (app_is_staff() OR app_is_platform_admin())
    AND app_can_access_project(binding."projectId")
  ORDER BY session."createdAt" DESC
  LIMIT 10
$$;

REVOKE ALL ON FUNCTION app_universal_recent_embed_sessions(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_universal_recent_embed_sessions(text)
  TO service_platform_app;

-- request.unread.changed 的 contactUnreadCount：该请求创建者名下全部请求的未读总数，
-- 口径与门户的未读合计一致（同项目、未归档）。
-- 触发写入的一方（员工 / 外部联系人本人）未必能按 RLS 读到联系人的其他请求，
-- 这里只要求对当前请求有访问权，只返回一个总数。
CREATE OR REPLACE FUNCTION app_external_contact_unread_total(p_service_request_id text)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(SUM(state."unreadCount"), 0)::integer
  FROM "ServiceRequest" request
  JOIN "ExternalRequestReadState" state
    ON state."externalContactId" = request."createdByExternalContactId"
  JOIN "ServiceRequest" owned
    ON owned.id = state."serviceRequestId"
    AND owned."createdByExternalContactId" = request."createdByExternalContactId"
    AND owned."projectId" = request."projectId"
    AND owned."archivedAt" IS NULL
  WHERE request.id = p_service_request_id
    AND app_can_access_request(p_service_request_id)
$$;

REVOKE ALL ON FUNCTION app_external_contact_unread_total(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_external_contact_unread_total(text)
  TO service_platform_app;
