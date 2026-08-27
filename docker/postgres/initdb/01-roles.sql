-- 本地开发角色（trust 认证，无密码）。仅首次初始化数据卷时执行。
-- 与生产/CI 的密码策略无关；属性对齐原 brew 集群里的同名角色。
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'a1234') THEN
    CREATE ROLE a1234 WITH SUPERUSER INHERIT CREATEROLE CREATEDB LOGIN REPLICATION BYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_platform_app') THEN
    CREATE ROLE service_platform_app WITH LOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_platform_jobs') THEN
    CREATE ROLE service_platform_jobs WITH LOGIN;
  END IF;
END
$$;

-- pg-boss 引导：worker 以 service_platform_jobs 运行 boss.start()，要建 pgboss schema，
-- PG16 默认不给普通角色库级 CREATE（实证报 permission denied for database）。
-- 与 scripts/prepare-integration-db.mjs 对测试库的授权口径一致；GRANT 幂等，
-- 也便于既有数据卷手工补跑。
GRANT CONNECT, CREATE ON DATABASE service_platform TO service_platform_jobs;
