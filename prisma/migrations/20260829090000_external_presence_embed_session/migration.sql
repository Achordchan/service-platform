-- ExternalRequestPresence.sessionId 存的是外部门户前端 crypto.randomUUID() 生成的
-- 每标签页临时 id，与服务端的 ExternalEmbedSession.id 毫无关系。
-- 「客户设备与网络」原先按它去连会话表取 IP/UA，永远连不上 —— 外部联系人的设备
-- 信息一直是空的。新增一列存真正的会话 id，由已鉴权的 requireExternalSession 写入。
ALTER TABLE "ExternalRequestPresence"
  ADD COLUMN IF NOT EXISTS "embedSessionId" TEXT;

CREATE INDEX IF NOT EXISTS "ExternalRequestPresence_embedSessionId_idx"
  ON "ExternalRequestPresence"("embedSessionId");

-- JOIN 改用真实关联；其余门禁（员工 + 对本工单有访问权）保持不变
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
  LEFT JOIN "ExternalEmbedSession" session
    ON session.id = presence."embedSessionId"
  WHERE presence."serviceRequestId" = request_id
    AND app_is_staff()
    AND app_can_access_request(request_id)
  ORDER BY presence."updatedAt" DESC
  LIMIT 20
$$;

REVOKE ALL ON FUNCTION app_external_request_client_contexts(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_external_request_client_contexts(text)
  TO service_platform_app;
