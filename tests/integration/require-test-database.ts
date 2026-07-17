import { URL } from "node:url";

const REQUIRED_ENV_KEYS = [
  "DATABASE_URL",
  "DATABASE_MIGRATION_URL",
] as const;

type DbEndpoint = {
  host: string;
  port: string;
  database: string;
};

/**
 * Integration suites may call production-side code that mutates plugin runs,
 * sessions, and migrations. Refuse any connection that is not clearly a
 * disposable test database.
 */
export function assertIntegrationTestDatabase() {
  const endpoints: Array<{ key: string; endpoint: DbEndpoint }> = [];

  for (const key of REQUIRED_ENV_KEYS) {
    const value = process.env[key];
    if (!value) {
      throw new Error(
        `[integration] ${key} 未设置。请指向一次性测试库（库名以 _test 结尾）。`,
      );
    }
    endpoints.push({ key, endpoint: assertDisposableDatabaseUrl(key, value) });
  }

  // Optional job queue URL, when present, must also stay on the same test database.
  if (process.env.JOB_DATABASE_URL) {
    endpoints.push({
      key: "JOB_DATABASE_URL",
      endpoint: assertDisposableDatabaseUrl(
        "JOB_DATABASE_URL",
        process.env.JOB_DATABASE_URL,
      ),
    });
  }

  assertSameDatabaseInstance(endpoints);
}

export function assertDisposableDatabaseUrl(
  envKey: string,
  connectionString: string,
): DbEndpoint {
  let url: URL;
  try {
    const normalized = connectionString.includes("://")
      ? connectionString
      : `postgresql://${connectionString}`;
    url = new URL(normalized);
  } catch {
    throw new Error(`[integration] ${envKey} 不是合法的 PostgreSQL 连接串`);
  }

  const database =
    decodeURIComponent(url.pathname.replace(/^\/+/, "")).split("/")[0] ?? "";
  if (!database) {
    throw new Error(`[integration] ${envKey} 缺少数据库名`);
  }

  // Accept names like service_platform_test or app_test.
  if (!/(^|_)test$/i.test(database)) {
    throw new Error(
      `[integration] 拒绝连接非测试数据库 "${database}"（来自 ${envKey}）。` +
        "请使用一次性集成测试库，库名必须以 _test 结尾，例如 service_platform_test。",
    );
  }

  const host = (url.hostname || "localhost").toLowerCase();
  const port = url.port || defaultPort(url.protocol);

  return { host, port, database };
}

function assertSameDatabaseInstance(
  endpoints: Array<{ key: string; endpoint: DbEndpoint }>,
) {
  if (endpoints.length < 2) return;

  const [baseline, ...rest] = endpoints;
  for (const current of rest) {
    if (
      current.endpoint.host !== baseline.endpoint.host ||
      current.endpoint.port !== baseline.endpoint.port ||
      current.endpoint.database !== baseline.endpoint.database
    ) {
      throw new Error(
        `[integration] ${current.key} 与 ${baseline.key} 必须指向同一测试库实例` +
          `（host/port/database）。当前: ` +
          `${formatEndpoint(baseline.key, baseline.endpoint)} vs ` +
          `${formatEndpoint(current.key, current.endpoint)}`,
      );
    }
  }
}

function formatEndpoint(key: string, endpoint: DbEndpoint) {
  return `${key}=${endpoint.host}:${endpoint.port}/${endpoint.database}`;
}

function defaultPort(protocol: string) {
  if (protocol === "postgresql:" || protocol === "postgres:") return "5432";
  return "";
}
