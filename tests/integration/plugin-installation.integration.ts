import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { imageWebpManifest } from "@achord/plugin-image-webp";
import {
  applyPluginDisableSideEffects,
  ensurePluginInstallations,
} from "@/modules/plugins/plugin-installation-service";
import { IMAGE_WEBP_PLUGIN_KEY } from "@/modules/plugins/plugin-registry";
import { assertIntegrationTestDatabase } from "./require-test-database";

assertIntegrationTestDatabase();

const pool = new Pool({
  connectionString: process.env.DATABASE_MIGRATION_URL,
  max: 1,
});

const ids = {
  versionRun: randomUUID(),
  invalidConfigRun: randomUUID(),
};

let previousWebp: {
  version: string;
  enabled: boolean;
  healthStatus: string;
  lastCheckedAt: Date | null;
  lastError: string | null;
  config: unknown;
} | null = null;

beforeAll(async () => {
  await ensurePluginInstallations();

  const webp = await pool.query<{
    version: string;
    enabled: boolean;
    healthStatus: string;
    lastCheckedAt: Date | null;
    lastError: string | null;
    config: unknown;
  }>(
    `
      SELECT
        version,
        enabled,
        "healthStatus",
        "lastCheckedAt",
        "lastError",
        config
      FROM "PluginInstallation"
      WHERE "key" = $1
    `,
    [IMAGE_WEBP_PLUGIN_KEY],
  );
  previousWebp = webp.rows[0] ?? null;

  // Disposable test DB only: these are the only runs we intentionally create.
  await pool.query(
    `
      INSERT INTO "PluginRun" (
        id,
        "pluginKey",
        kind,
        status,
        "updatedAt"
      )
      VALUES
        ($1, $3, 'VERSION_SYNC_TEST', 'RUNNING', NOW()),
        ($2, $3, 'INVALID_CONFIG_TEST', 'RUNNING', NOW())
    `,
    [ids.versionRun, ids.invalidConfigRun, IMAGE_WEBP_PLUGIN_KEY],
  );
});

afterAll(async () => {
  await pool.query(`DELETE FROM "PluginRun" WHERE id = ANY($1::text[])`, [
    [ids.versionRun, ids.invalidConfigRun],
  ]);

  if (previousWebp) {
    await pool.query(
      `
        UPDATE "PluginInstallation"
        SET
          version = $2,
          enabled = $3,
          "healthStatus" = $4,
          "lastCheckedAt" = $5,
          "lastError" = $6,
          config = $7::jsonb,
          "updatedAt" = NOW()
        WHERE "key" = $1
      `,
      [
        IMAGE_WEBP_PLUGIN_KEY,
        previousWebp.version,
        previousWebp.enabled,
        previousWebp.healthStatus,
        previousWebp.lastCheckedAt,
        previousWebp.lastError,
        JSON.stringify(previousWebp.config ?? {}),
      ],
    );
  }

  await pool.end();
});

describe("插件安装同步", () => {
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
    await pool.query(
      `
        UPDATE "PluginRun"
        SET status = 'RUNNING', "updatedAt" = NOW()
        WHERE id = $1
      `,
      [ids.versionRun],
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
        JOIN "PluginRun" run ON run.id = $2
        WHERE installation.key = $1
      `,
      [IMAGE_WEBP_PLUGIN_KEY, ids.versionRun],
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

  it("同版本非法配置会停用插件并暂停本插件任务", async () => {
    await pool.query(
      `
        UPDATE "PluginInstallation"
        SET
          version = $2,
          enabled = true,
          "healthStatus" = 'READY',
          "lastCheckedAt" = NOW(),
          "lastError" = NULL,
          config = '123'::jsonb,
          "updatedAt" = NOW()
        WHERE "key" = $1
      `,
      [IMAGE_WEBP_PLUGIN_KEY, previousWebp?.version ?? imageWebpManifest.version],
    );
    await pool.query(
      `
        UPDATE "PluginRun"
        SET status = 'RUNNING', "updatedAt" = NOW()
        WHERE id = $1
      `,
      [ids.invalidConfigRun],
    );

    await ensurePluginInstallations();

    const result = await pool.query<{
      enabled: boolean;
      healthStatus: string;
      lastError: string | null;
      runStatus: string;
    }>(
      `
        SELECT
          installation.enabled,
          installation."healthStatus",
          installation."lastError",
          run.status::text AS "runStatus"
        FROM "PluginInstallation" installation
        JOIN "PluginRun" run ON run.id = $2
        WHERE installation.key = $1
      `,
      [IMAGE_WEBP_PLUGIN_KEY, ids.invalidConfigRun],
    );

    expect(result.rows[0]?.enabled).toBe(false);
    expect(result.rows[0]?.healthStatus).toBe("ERROR");
    expect(result.rows[0]?.lastError ?? "").toContain("配置无效");
    expect(result.rows[0]?.runStatus).toBe("PAUSED");
  });

  it("applyPluginDisableSideEffects 会暂停运行中任务并撤销未过期嵌入会话", async () => {
    const calls: Array<{ table: string; where: unknown; data: unknown }> = [];
    const tx = {
      pluginRun: {
        updateMany: async (args: { where: unknown; data: unknown }) => {
          calls.push({ table: "PluginRun", where: args.where, data: args.data });
          return { count: 1 };
        },
      },
      externalEmbedSession: {
        updateMany: async (args: { where: unknown; data: unknown }) => {
          calls.push({
            table: "ExternalEmbedSession",
            where: args.where,
            data: args.data,
          });
          return { count: 1 };
        },
      },
      universalLaunchTicket: {
        updateMany: async (args: { where: unknown; data: unknown }) => {
          calls.push({
            table: "UniversalLaunchTicket",
            where: args.where,
            data: args.data,
          });
          return { count: 1 };
        },
      },
    };

    await applyPluginDisableSideEffects(tx as never, "sub2api-connector");

    expect(calls).toEqual([
      {
        table: "PluginRun",
        where: {
          pluginKey: "sub2api-connector",
          status: { in: ["QUEUED", "RUNNING"] },
        },
        data: { status: "PAUSED" },
      },
      {
        table: "ExternalEmbedSession",
        where: {
          binding: { pluginKey: "sub2api-connector" },
          revokedAt: null,
        },
        data: { revokedAt: expect.any(Date) },
      },
      {
        table: "UniversalLaunchTicket",
        where: {
          connection: { binding: { pluginKey: "sub2api-connector" } },
          consumedAt: null,
          expiresAt: { gt: expect.any(Date) },
        },
        data: { expiresAt: expect.any(Date) },
      },
    ]);
  });
});
