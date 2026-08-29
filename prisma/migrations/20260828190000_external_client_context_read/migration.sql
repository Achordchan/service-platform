-- 「客户设备与网络」要展示外部门户联系人的 IP 与 UA，它们记在
-- ExternalEmbedSession 上。但 external_embed_session_select 只允许会话本人或
-- 平台管理员读取，普通项目经理/技术人员在自己的 RLS 会话里会被静默过滤成零行 ——
-- 外部联系人出现在列表里，设备/IP 却永远是空的。
--
-- 与 app_notification_email_optouts 同一套做法：以表所有者身份执行绕过 RLS，
-- 但函数自己把住门 —— 必须是员工，且必须对该工单有访问权（app_can_access_request
-- 与 RLS 用的是同一个谓词）。只暴露这一个工单的 ip/ua，不开放会话表读取。
CREATE OR REPLACE FUNCTION app_external_request_client_contexts(request_id text)
RETURNS TABLE (
  presence_id text,
  contact_id text,
  contact_name text,
  contact_email text,
  expires_at timestamp(3),
  updated_at timestamp(3),
  ip_address text,
  user_agent text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    presence.id,
    contact.id,
    contact."displayName",
    contact.email,
    presence."expiresAt",
    presence."updatedAt",
    session."ipAddress",
    session."userAgent"
  FROM "ExternalRequestPresence" presence
  JOIN "ExternalContact" contact ON contact.id = presence."externalContactId"
  LEFT JOIN "ExternalEmbedSession" session ON session.id = presence."sessionId"
  WHERE presence."serviceRequestId" = request_id
    AND app_is_staff()
    AND app_can_access_request(request_id)
  ORDER BY presence."updatedAt" DESC
  LIMIT 20
$$;

REVOKE ALL ON FUNCTION app_external_request_client_contexts(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_external_request_client_contexts(text)
  TO service_platform_app;
