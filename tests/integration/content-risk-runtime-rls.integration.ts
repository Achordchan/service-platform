import { afterAll, describe, expect, it } from "vitest";
import { Client } from "pg";

const client = new Client({
  connectionString: process.env.DATABASE_MIGRATION_URL,
});

afterAll(async () => {
  await client.end().catch(() => undefined);
});

describe("内容风控运行状态 RLS", () => {
  it("客户数据库会话可以读取最小运行配置但不能直接读取插件安装记录", async () => {
    await client.connect();
    await client.query("BEGIN");
    try {
      await client.query(`
        UPDATE "PluginInstallation"
        SET enabled = TRUE,
            "healthStatus" = 'READY',
            config = jsonb_build_object(
              'baseUrl', 'https://provider.example.test/v1',
              'model', 'risk-model',
              'fullAuditEnabled', TRUE,
              'allowedDomains', jsonb_build_array('example.com')
            ),
            "updatedAt" = NOW()
        WHERE key = 'content-contact-risk'
      `);
      await client.query(`
        INSERT INTO "ContentRiskRuntimeState" (
          "pluginKey",
          "activationId",
          "enabledAt",
          "updatedAt"
        ) VALUES (
          'content-contact-risk',
          'rls-test-activation',
          NOW(),
          NOW()
        )
        ON CONFLICT ("pluginKey") DO UPDATE SET
          "activationId" = EXCLUDED."activationId",
          "enabledAt" = EXCLUDED."enabledAt",
          "bypassedAt" = NULL,
          "updatedAt" = NOW()
      `);

      await client.query("SET LOCAL ROLE service_platform_app");
      await client.query(`SELECT set_config('app.user_id', 'customer-test', true)`);
      await client.query(`SELECT set_config('app.is_platform_admin', 'false', true)`);
      await client.query(`SELECT set_config('app.is_staff', 'false', true)`);

      const hiddenInstallation = await client.query(
        `SELECT key FROM "PluginInstallation" WHERE key = 'content-contact-risk'`,
      );
      expect(hiddenInstallation.rowCount).toBe(0);

      const runtime = await client.query<{
        activationId: string;
        model: string;
        fullAuditEnabled: boolean;
        allowedDomains: string[];
      }>(`SELECT * FROM app_get_content_risk_runtime()`);
      expect(runtime.rows).toEqual([
        expect.objectContaining({
          activationId: "rls-test-activation",
          model: "risk-model",
          fullAuditEnabled: true,
          allowedDomains: ["example.com"],
        }),
      ]);
    } finally {
      await client.query("ROLLBACK");
    }
  });
});
