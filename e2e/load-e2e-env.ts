import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { assertIntegrationTestDatabase } from "../tests/integration/require-test-database";

const ENV_CANDIDATES = [".env.e2e", ".env.integration"] as const;

/**
 * Playwright and its webServer must share a disposable *_test database.
 * Main .env is intentionally never used for DATABASE_* keys.
 */
export function loadE2EEnv() {
  let loadedFrom: string | null = null;

  // Drop any parent-shell main-database URLs so only e2e/integration env can supply them.
  for (const key of [
    "DATABASE_URL",
    "DATABASE_MIGRATION_URL",
    "JOB_DATABASE_URL",
  ]) {
    delete process.env[key];
  }

  for (const candidate of ENV_CANDIDATES) {
    const fullPath = resolve(process.cwd(), candidate);
    if (!existsSync(fullPath)) continue;
    applyEnvFile(fullPath, { override: true });
    loadedFrom = candidate;
    break;
  }

  if (!loadedFrom) {
    throw new Error(
      "[e2e] 缺少 .env.e2e 或 .env.integration。请先创建 *_test 库并执行 pnpm test:integration:prepare，" +
        "禁止 Playwright 直连主库 .env。",
    );
  }

  assertIntegrationTestDatabase();
  return loadedFrom;
}

export function e2eWebServerEnv(): Record<string, string> {
  loadE2EEnv();

  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );

  // Destructive E2E always runs against the local Playwright-managed server.
  env.APP_URL = "http://127.0.0.1:3000";
  env.BETTER_AUTH_URL = "http://127.0.0.1:3000";
  env.PLAYWRIGHT_BASE_URL = "http://127.0.0.1:3000";
  delete env.PLAYWRIGHT_REUSE_SERVER;

  return env;
}

function applyEnvFile(fullPath: string, options: { override: boolean }) {
  const source = readFileSync(fullPath, "utf8");
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
    if (options.override || process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}
