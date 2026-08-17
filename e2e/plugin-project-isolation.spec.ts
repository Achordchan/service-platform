import { expect, test } from "@playwright/test";
import { Pool } from "pg";
import { loadE2EEnv } from "./load-e2e-env";

loadE2EEnv();

const ownerPool = new Pool({
  connectionString: process.env.DATABASE_MIGRATION_URL,
  max: 1,
});
const password = "ServiceDemo!2026";
let previousPlugin: {
  enabled: boolean;
  healthStatus: string;
  config: unknown;
} | null = null;

test.beforeAll(async () => {
  const current = await ownerPool.query<{
    enabled: boolean;
    healthStatus: string;
    config: unknown;
  }>(
    `SELECT enabled, "healthStatus", config
     FROM "PluginInstallation"
     WHERE key = 'sub2api-connector'`,
  );
  previousPlugin = current.rows[0] ?? null;
  await ownerPool.query(
    `UPDATE "PluginInstallation"
     SET enabled = true,
         "healthStatus" = 'READY',
         config = '{"quality":82,"effort":2,"maxInputMegapixels":40,"minimumSavingsPercent":5}'::jsonb,
         "updatedAt" = NOW()
     WHERE key = 'sub2api-connector'`,
  );
});

test.afterAll(async () => {
  try {
    if (previousPlugin) {
      await ownerPool.query(
        `UPDATE "PluginInstallation"
         SET enabled = $2,
             "healthStatus" = $3,
             config = $4::jsonb,
             "updatedAt" = NOW()
         WHERE key = $1`,
        [
          "sub2api-connector",
          previousPlugin.enabled,
          previousPlugin.healthStatus,
          JSON.stringify(previousPlugin.config ?? {}),
        ],
      );
    } else {
      await ownerPool.query(
        `UPDATE "PluginInstallation"
         SET enabled = false,
             "healthStatus" = 'UNKNOWN',
             config = '{}'::jsonb,
             "updatedAt" = NOW()
         WHERE key = 'sub2api-connector'`,
      );
    }
  } finally {
    await ownerPool.end();
  }
});

test("插件设置与外部项目客户选择保持隔离", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("邮箱").fill("admin@local.test");
  await page.getByLabel("密码", { exact: true }).fill(password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.waitForURL(/\/staff\//);

  await page.goto("/staff/plugins");
  await page
    .getByRole("button", { name: "管理Sub2API 服务请求连接器" })
    .click();
  const pluginDialog = page.getByRole("dialog");
  await expect(pluginDialog.getByText("Sub2API 服务请求连接器")).toBeVisible();
  await expect(pluginDialog.getByText("插件设置")).toHaveCount(0);
  await expect(pluginDialog.getByText("历史图片迁移")).toHaveCount(0);
  await expect(pluginDialog.getByText("WebP 质量")).toHaveCount(0);
  await pluginDialog.getByRole("button", { name: "关闭" }).click();

  const stored = await ownerPool.query<{ config: unknown }>(
    `SELECT config FROM "PluginInstallation" WHERE key = 'sub2api-connector'`,
  );
  expect(stored.rows[0]?.config).toEqual({});

  await page.goto("/staff/projects");
  await page.getByRole("button", { name: "新建项目" }).click();
  const projectDialog = page.getByRole("dialog");
  await projectDialog.getByRole("button", { name: "外部接入项目" }).click();
  await expect(projectDialog.getByLabel("客户")).toHaveCount(0);
  await expect(projectDialog.getByText("无需选择客户")).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(projectDialog).toBeVisible();
  const hasHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(hasHorizontalOverflow).toBe(false);
});
