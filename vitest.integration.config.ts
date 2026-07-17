import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vitest/config";
import { assertIntegrationTestDatabase } from "./tests/integration/require-test-database";

loadLocalEnv();
// Fail closed before any suite opens a Pool against the developer's main DB.
assertIntegrationTestDatabase();

export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(process.cwd(), "src"),
      "server-only": resolve(
        process.cwd(),
        "tests/integration/server-only.ts",
      ),
    },
  },
  test: {
    environment: "node",
    include: ["tests/integration/**/*.integration.ts"],
    fileParallelism: false,
    hookTimeout: 30_000,
    testTimeout: 30_000,
    setupFiles: [resolve(process.cwd(), "tests/integration/setup-integration.ts")],
  },
});

function loadLocalEnv() {
  // Prefer an explicit integration env file when present.
  for (const candidate of [".env.integration", ".env"]) {
    try {
      const source = readFileSync(resolve(process.cwd(), candidate), "utf8");
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
        // .env.integration overrides .env for the same key.
        if (candidate === ".env.integration" || process.env[key] === undefined) {
          process.env[key] = value;
        }
      }
    } catch {
      // optional file
    }
  }
}
