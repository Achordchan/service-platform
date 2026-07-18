import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { Pool } from "pg";
import { loadE2EEnv } from "./load-e2e-env";

loadE2EEnv();

const ownerPool = new Pool({
  connectionString: process.env.DATABASE_MIGRATION_URL,
  max: 1,
});
const publicId = `e2e-connect-${randomUUID()}`;
const projectId = randomUUID();
const bindingId = randomUUID();
let previousPlugin: { enabled: boolean; healthStatus: string } | null = null;

test.beforeAll(async () => {
  const plugin = await ownerPool.query<{
    enabled: boolean;
    healthStatus: string;
  }>(
    `SELECT enabled, "healthStatus" FROM "PluginInstallation" WHERE key = 'universal-embed-connector'`,
  );
  previousPlugin = plugin.rows[0] ?? null;
  await ownerPool.query(
    `UPDATE "PluginInstallation" SET enabled = true, "healthStatus" = 'READY', "updatedAt" = NOW() WHERE key = 'universal-embed-connector'`,
  );
  const base = await ownerPool.query<{
    customerSpaceId: string;
    serviceTypeId: string;
    createdById: string;
  }>(
    `SELECT "customerSpaceId", "serviceTypeId", "createdById" FROM "Project" LIMIT 1`,
  );
  const row = base.rows[0];
  if (!row) throw new Error("缺少 seed 项目");
  await ownerPool.query(
    `INSERT INTO "Project" (id, title, status, kind, "customerSpaceId", "serviceTypeId", "createdById", "updatedAt") VALUES ($1, 'Achord Connect E2E', 'ACTIVE', 'EXTERNAL_INTEGRATION', $2, $3, $4, NOW())`,
    [projectId, row.customerSpaceId, row.serviceTypeId, row.createdById],
  );
  await ownerPool.query(
    `INSERT INTO "ProjectPluginBinding" (id, "projectId", "pluginKey", "externalConnectorSlot", "publicId", status, "updatedAt") VALUES ($1, $2, 'universal-embed-connector', 'PRIMARY', $3, 'ACTIVE', NOW())`,
    [bindingId, projectId, publicId],
  );
  await ownerPool.query(
    `INSERT INTO "UniversalConnectorConnection" ("bindingId", name, "allowedOrigins", "profileFields", "healthStatus", "updatedAt") VALUES ($1, 'E2E 连接', '["http://127.0.0.1:3000"]'::jsonb, '[]'::jsonb, 'READY', NOW())`,
    [bindingId],
  );
});

test.afterAll(async () => {
  await ownerPool.query(`DELETE FROM "Project" WHERE id = $1`, [projectId]);
  if (previousPlugin) {
    await ownerPool.query(
      `UPDATE "PluginInstallation" SET enabled = $2, "healthStatus" = $3, "updatedAt" = NOW() WHERE key = $1`,
      [
        "universal-embed-connector",
        previousPlugin.enabled,
        previousPlugin.healthStatus,
      ],
    );
  }
  await ownerPool.end();
});

async function mockUniversalApi(page: Page) {
  await page.route("**/api/v1/embed/universal/exchange", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          token: "universal-session-token",
          expiresAt: "2027-07-18T18:00:00.000Z",
          contact: {
            id: "universal-contact-1",
            externalUserId: "host-user-1",
            name: "通用接入用户",
            email: "host@example.com",
            username: "host-user",
          },
          parentOrigins: ["http://127.0.0.1:3000"],
          project: {
            id: projectId,
            title: "Achord Connect E2E",
            status: "ACTIVE",
          },
          context: { theme: "dark", locale: "en-US" },
        },
      }),
    }),
  );
  await page.route("**/api/v1/embed/requests", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          project: {
            id: projectId,
            title: "Achord Connect E2E",
            status: "ACTIVE",
            writable: true,
          },
          categories: [{ id: "category-1", name: "产品支持" }],
          requests: [
            {
              id: "request-1",
              number: "SR-E2E-001",
              title: "通用接入测试工单",
              description: "测试 iframe",
              priority: "NORMAL",
              status: "PENDING",
              unreadCount: 2,
              createdAt: "2026-07-18T10:00:00.000Z",
              updatedAt: "2026-07-18T10:00:00.000Z",
              category: { id: "category-1", name: "产品支持" },
            },
          ],
        },
      }),
    }),
  );
  await page.route("**/api/v1/embed/stream", (route) =>
    route.fulfill({
      contentType: "text/event-stream",
      body: "event: STREAM_READY\ndata: {\"eventId\":\"0\"}\n\n",
    }),
  );
}

for (const viewport of [
  { name: "desktop", width: 1280, height: 800 },
  { name: "mobile", width: 390, height: 844 },
]) {
  test(`Achord Connect ${viewport.name} 门户清理 fragment 且无横向溢出`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await mockUniversalApi(page);
    await page.goto(`/embed/connect/${publicId}#ticket=sensitive-ticket`, {
      referer: "http://127.0.0.1:3000/third-party-host",
    });
    await expect(page.getByText("通用接入测试工单")).toBeVisible();
    await expect(page).toHaveURL(`/embed/connect/${publicId}`);
    expect(await page.evaluate(() => document.documentElement.lang)).toBe(
      "en-US",
    );
    expect(
      await page
        .getByTestId("external-embed-shell")
        .evaluate((element) => getComputedStyle(element).backgroundColor),
    ).toBe("rgb(17, 20, 24)");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  });
}

test("Achord Connect 缺失父页面来源时拒绝兑换", async ({ page }) => {
  await mockUniversalApi(page);
  await page.goto(`/embed/connect/${publicId}#ticket=missing-parent-origin`);
  await expect(
    page.getByText("无法确认 iframe 宿主来源，请返回原系统重新进入"),
  ).toBeVisible();
  await expect(page).toHaveURL(`/embed/connect/${publicId}`);
});

test("iframe 仅向可信父 Origin 发送受控状态消息", async ({ page }) => {
  await mockUniversalApi(page);
  await page.route("**/__achord-connect-e2e-host", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<!doctype html>
        <html lang="zh-CN">
          <head><meta charset="utf-8"><title>Achord Connect Host</title></head>
          <body style="margin:0">
            <iframe title="Achord Connect" src="/embed/connect/${publicId}#ticket=parent-ticket" style="width:100%;height:800px;border:0"></iframe>
            <script>
              window.__achordMessages = [];
              window.addEventListener("message", (event) => {
                if (event.origin === window.location.origin) {
                  window.__achordMessages.push(event.data);
                }
              });
            </script>
          </body>
        </html>`,
    }),
  );
  await page.goto("/__achord-connect-e2e-host");
  const frame = page.frameLocator('iframe[title="Achord Connect"]');
  await expect(frame.getByText("通用接入测试工单")).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() =>
        ((window as unknown as { __achordMessages?: Array<{ type?: string }> })
          .__achordMessages ?? [])
          .map((message) => message.type),
      ),
    )
    .toEqual(expect.arrayContaining(["ready", "height", "unread-changed"]));
  const payloads = await page.evaluate(
    () =>
      (window as unknown as { __achordMessages?: unknown[] }).__achordMessages ?? [],
  );
  expect(JSON.stringify(payloads)).not.toContain("universal-session-token");
  expect(JSON.stringify(payloads)).not.toContain("通用接入测试工单");
});
