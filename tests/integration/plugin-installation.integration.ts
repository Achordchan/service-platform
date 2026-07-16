import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { imageWebpManifest } from "@achord/plugin-image-webp";
import { ensurePluginInstallations } from "@/modules/plugins/plugin-installation-service";
import { IMAGE_WEBP_PLUGIN_KEY } from "@/modules/plugins/plugin-registry";

const pool = new Pool({
  connectionString: process.env.DATABASE_MIGRATION_URL,
  max: 1,
});
const testRunId = randomUUID();

let previousInstallation: {
  version: string;
  enabled: boolean;
  healthStatus: string;
  lastCheckedAt: Date | null;
  lastError: string | null;
} | null = null;
let previousActiveRuns: Array<{ id: string; status: string }> = [];

beforeAll(async () => {
  await ensurePluginInstallations();
  const result = await pool.query<{
    version: string;
    enabled: boolean;
    healthStatus: string;
    lastCheckedAt: Date | null;
    lastError: string | null;
  }>(
    `
      SELECT
        version,
        enabled,
        "healthStatus",
        "lastCheckedAt",
        "lastError"
      FROM "PluginInstallation"
      WHERE "key" = $1
    `,
    [IMAGE_WEBP_PLUGIN_KEY],
  );
  previousInstallation = result.rows[0] ?? null;
  const activeRuns = await pool.query<{ id: string; status: string }>(
    `
      SELECT id, status::text
      FROM "PluginRun"
      WHERE "pluginKey" = $1
        AND status IN ('QUEUED', 'RUNNING')
    `,
    [IMAGE_WEBP_PLUGIN_KEY],
  );
  previousActiveRuns = activeRuns.rows;
  await pool.query(
    `
      INSERT INTO "PluginRun" (
        id,
        "pluginKey",
        kind,
        status,
        "updatedAt"
      )
      VALUES ($1, $2, 'VERSION_SYNC_TEST', 'RUNNING', NOW())
    `,
    [testRunId, IMAGE_WEBP_PLUGIN_KEY],
  );
});

afterAll(async () => {
  await pool.query(`DELETE FROM "PluginRun" WHERE id = $1`, [testRunId]);
  for (const run of previousActiveRuns) {
    await pool.query(
      `
        UPDATE "PluginRun"
        SET status = $2::"PluginRunStatus", "updatedAt" = NOW()
        WHERE id = $1
      `,
      [run.id, run.status],
    );
  }
  if (previousInstallation) {
    await pool.query(
      `
        UPDATE "PluginInstallation"
        SET
          version = $2,
          enabled = $3,
          "healthStatus" = $4,
          "lastCheckedAt" = $5,
          "lastError" = $6,
          "updatedAt" = NOW()
        WHERE "key" = $1
      `,
      [
        IMAGE_WEBP_PLUGIN_KEY,
        previousInstallation.version,
        previousInstallation.enabled,
        previousInstallation.healthStatus,
        previousInstallation.lastCheckedAt,
        previousInstallation.lastError,
      ],
    );
  }
  await pool.end();
});

describe("插件安装版本同步", () => {
  it("版本变化时停用插件并清除旧健康结果", async () => {
    await pool.query(
      `
        UPDATE "PluginInstallation"
        SET
          version = '0.9.9',
          enabled = true,
          "healthStatus" = 'ERROR',
          "lastCheckedAt" = NOW(),
          "lastError" = '旧版本运行错误',
          "updatedAt" = NOW()
        WHERE "key" = $1
      `,
      [IMAGE_WEBP_PLUGIN_KEY],
    );

    await ensurePluginInstallations();

    const result = await pool.query<{
      version: string;
      enabled: boolean;
      healthStatus: string;
      lastCheckedAt: Date | null;
      lastError: string | null;
      runStatus: string;
    }>(
      `
        SELECT
          installation.version,
          installation.enabled,
          installation."healthStatus",
          installation."lastCheckedAt",
          installation."lastError",
          run.status::text AS "runStatus"
        FROM "PluginInstallation" installation
        JOIN "PluginRun" run ON run."pluginKey" = installation.key
        WHERE installation.key = $1
          AND run.id = $2
      `,
      [IMAGE_WEBP_PLUGIN_KEY, testRunId],
    );

    expect(result.rows[0]).toEqual({
      version: imageWebpManifest.version,
      enabled: false,
      healthStatus: "UNKNOWN",
      lastCheckedAt: null,
      lastError: null,
      runStatus: "PAUSED",
    });
  });
});
