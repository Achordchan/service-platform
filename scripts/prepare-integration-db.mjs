#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { URL } from "node:url";
import pg from "pg";

const ROOT = process.cwd();
const INTEGRATION_ENV = resolve(ROOT, ".env.integration");

function fail(message) {
  console.error(`[test:integration:prepare] ${message}`);
  process.exit(1);
}

function loadIntegrationEnv() {
  if (!existsSync(INTEGRATION_ENV)) {
    fail(
      "缺少 .env.integration。请先按 .env.example 创建并指向 *_test 数据库；禁止使用主库 .env。",
    );
  }

  // Drop any preloaded main-database URLs so only .env.integration can supply them.
  for (const key of [
    "DATABASE_URL",
    "DATABASE_MIGRATION_URL",
    "JOB_DATABASE_URL",
  ]) {
    delete process.env[key];
  }

  const source = readFileSync(INTEGRATION_ENV, "utf8");
  for (const line of source.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator < 1) continue;
    const key = trimmed.slice(0, separator);
    const value = trimmed
      .slice(separator + 1)
      .trim()
      .replace(/^(['"])(.*)\1$/, "$2");
    process.env[key] = value;
  }
}

function parseDatabaseEndpoint(connectionString, envKey) {
  try {
    const normalized = connectionString.includes("://")
      ? connectionString
      : `postgresql://${connectionString}`;
    const url = new URL(normalized);
    const database =
      decodeURIComponent(url.pathname.replace(/^\/+/, "")).split("/")[0] ?? "";
    const host = (url.hostname || "localhost").toLowerCase();
    const port =
      url.port ||
      (url.protocol === "postgresql:" || url.protocol === "postgres:"
        ? "5432"
        : "");
    return { host, port, database };
  } catch {
    fail(`${envKey} 不是合法的 PostgreSQL 连接串`);
  }
  return { host: "", port: "", database: "" };
}

function assertTestDatabase(envKey, connectionString) {
  if (!connectionString) {
    fail(`${envKey} 未设置（必须写在 .env.integration）`);
  }
  const endpoint = parseDatabaseEndpoint(connectionString, envKey);
  if (!endpoint.database) {
    fail(`${envKey} 缺少数据库名`);
  }
  if (!/(^|_)test$/i.test(endpoint.database)) {
    fail(
      `拒绝操作非测试数据库 "${endpoint.database}"（${envKey}）。库名必须以 _test 结尾。`,
    );
  }
  return endpoint;
}

function assertSameDatabaseInstance(endpoints) {
  const [baseline, ...rest] = endpoints;
  for (const current of rest) {
    if (
      current.endpoint.host !== baseline.endpoint.host ||
      current.endpoint.port !== baseline.endpoint.port ||
      current.endpoint.database !== baseline.endpoint.database
    ) {
      fail(
        `${current.key} 与 ${baseline.key} 必须指向同一测试库实例（host/port/database）`,
      );
    }
  }
}

function quoteIdent(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function run(command, args, env = process.env) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    env,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    fail(`${command} ${args.join(" ")} 失败（exit=${result.status ?? "null"}）`);
  }
}

async function grantJobRole(migrationUrl, jobUrl, databaseName) {
  let jobUser = "";
  try {
    jobUser = new URL(jobUrl.includes("://") ? jobUrl : `postgresql://${jobUrl}`).username;
  } catch {
    fail("JOB_DATABASE_URL 不是合法的 PostgreSQL 连接串");
  }
  if (!jobUser) {
    fail("JOB_DATABASE_URL 缺少用户名");
  }

  const client = new pg.Client({ connectionString: migrationUrl });
  await client.connect();
  try {
    // CONNECT/CREATE are database-level privileges; required for pg-boss bootstrap.
    await client.query(
      `GRANT CONNECT, CREATE ON DATABASE ${quoteIdent(databaseName)} TO ${quoteIdent(jobUser)}`,
    );
    await client.query(
      `GRANT USAGE, CREATE ON SCHEMA public TO ${quoteIdent(jobUser)}`,
    );
    await client.query(
      `GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO ${quoteIdent(jobUser)}`,
    );
    await client.query(
      `GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO ${quoteIdent(jobUser)}`,
    );
    await client.query(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO ${quoteIdent(jobUser)}`,
    );
    await client.query(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO ${quoteIdent(jobUser)}`,
    );
    console.log(
      `[test:integration:prepare] granted CONNECT/CREATE on ${databaseName} to ${jobUser}`,
    );
  } finally {
    await client.end();
  }
}

async function main() {
  loadIntegrationEnv();

  const migrationUrl = process.env.DATABASE_MIGRATION_URL;
  const appUrl = process.env.DATABASE_URL;
  const jobUrl = process.env.JOB_DATABASE_URL;

  const migrationEndpoint = assertTestDatabase(
    "DATABASE_MIGRATION_URL",
    migrationUrl,
  );
  const appEndpoint = assertTestDatabase("DATABASE_URL", appUrl);
  const jobEndpoint = assertTestDatabase("JOB_DATABASE_URL", jobUrl);
  assertSameDatabaseInstance([
    { key: "DATABASE_URL", endpoint: appEndpoint },
    { key: "DATABASE_MIGRATION_URL", endpoint: migrationEndpoint },
    { key: "JOB_DATABASE_URL", endpoint: jobEndpoint },
  ]);
  const migrationDb = migrationEndpoint.database;

  // Force child tools to load only .env.integration (prisma.config uses dotenv/config).
  const childEnv = {
    ...process.env,
    DATABASE_URL: appUrl,
    DATABASE_MIGRATION_URL: migrationUrl,
    JOB_DATABASE_URL: jobUrl,
    DOTENV_CONFIG_PATH: INTEGRATION_ENV,
    INTEGRATION_TEST_PREPARE: "1",
  };

  console.log(`[test:integration:prepare] target database = ${migrationDb}`);
  console.log("[test:integration:prepare] prisma migrate deploy");
  run("pnpm", ["exec", "prisma", "migrate", "deploy"], childEnv);

  await grantJobRole(migrationUrl, jobUrl, migrationDb);

  console.log("[test:integration:prepare] db seed");
  run(
    "pnpm",
    [
      "exec",
      "tsx",
      "--env-file=.env.integration",
      "prisma/seed.ts",
    ],
    childEnv,
  );

  console.log("[test:integration:prepare] ready");
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
