-- 保留期清理必须绕过 RLS：request_presence_delete 要求
-- "userId" = app_user_id()，而清理任务跑在 withSystemDb（app.user_id = 'system'）下，
-- 即使 is_platform_admin 为 true 也匹配不上 —— deleteMany 会被静默过滤成 0 行，
-- 平台用户的过期 IP/UA 就永久堆着（外部联系人那张表的策略不同，反而清得掉，
-- 于是问题更隐蔽：任务看起来在工作）。
--
-- 与本仓库既有做法一致：SECURITY DEFINER + REVOKE FROM PUBLIC。
-- cutoff 被 LEAST 夹住，调用方只能清「已过保留期」的行，传个未来时间也删不掉在线记录。
CREATE OR REPLACE FUNCTION app_sweep_expired_request_presence(cutoff timestamp(3))
RETURNS TABLE (internal_deleted bigint, external_deleted bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  safe_cutoff timestamp(3) := LEAST(
    cutoff,
    (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') - INTERVAL '24 hours'
  );
  internal_count bigint;
  external_count bigint;
BEGIN
  DELETE FROM "RequestPresence" WHERE "expiresAt" < safe_cutoff;
  GET DIAGNOSTICS internal_count = ROW_COUNT;
  DELETE FROM "ExternalRequestPresence" WHERE "expiresAt" < safe_cutoff;
  GET DIAGNOSTICS external_count = ROW_COUNT;
  RETURN QUERY SELECT internal_count, external_count;
END;
$$;

REVOKE ALL ON FUNCTION app_sweep_expired_request_presence(timestamp(3)) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_sweep_expired_request_presence(timestamp(3))
  TO service_platform_app;
