-- 在线状态区分来源端（小程序 / Web），并记录排查所需的设备、时区与来源 IP。
-- UA 与 IP 由服务端从请求头取，不信客户端自报；时区只能由客户端提供。
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PresenceClient') THEN
    CREATE TYPE "PresenceClient" AS ENUM ('WEB', 'MINIAPP');
  END IF;
END
$$;

ALTER TABLE "RequestPresence"
  ADD COLUMN IF NOT EXISTS "client" "PresenceClient" NOT NULL DEFAULT 'WEB',
  ADD COLUMN IF NOT EXISTS "userAgent" TEXT,
  ADD COLUMN IF NOT EXISTS "timezone" TEXT,
  ADD COLUMN IF NOT EXISTS "ipAddress" TEXT;
