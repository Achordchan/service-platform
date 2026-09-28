import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  expect,
  test,
  type APIRequestContext,
  type Browser,
  type Page,
} from "@playwright/test";
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
const password = process.env.E2E_PASSWORD ?? "ServiceDemo!2026";
// Native Launch 用独立连接：只开 Native Launch、不配 Origin，走真实签票 / 兑换 / 收发
const nativeProjectId = randomUUID();
const nativeBindingId = randomUUID();
const nativePublicId = `e2e-native-${randomUUID()}`;
const nativeClientId = `ac_e2e_${randomBytes(12).toString("base64url")}`;
const nativeClientSecret = `acs_e2e_${randomBytes(24).toString("base64url")}`;
const nativeUserId = `native-user-${randomUUID()}`;
const iframeClientId = `ac_e2e_${randomBytes(12).toString("base64url")}`;
const iframeClientSecret = `acs_e2e_${randomBytes(24).toString("base64url")}`;
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
  await ownerPool.query(
    `INSERT INTO "Project" (id, title, status, kind, "customerSpaceId", "serviceTypeId", "createdById", "updatedAt") VALUES ($1, 'Achord Connect Native E2E', 'ACTIVE', 'EXTERNAL_INTEGRATION', $2, $3, $4, NOW())`,
    [nativeProjectId, row.customerSpaceId, row.serviceTypeId, row.createdById],
  );
  await ownerPool.query(
    `INSERT INTO "ProjectPluginBinding" (id, "projectId", "pluginKey", "externalConnectorSlot", "publicId", status, "updatedAt") VALUES ($1, $2, 'universal-embed-connector', 'PRIMARY', $3, 'ACTIVE', NOW())`,
    [nativeBindingId, nativeProjectId, nativePublicId],
  );
  await ownerPool.query(
    `INSERT INTO "UniversalConnectorConnection" ("bindingId", name, "allowedOrigins", "allowNativeLaunch", "profileFields", "healthStatus", "updatedAt") VALUES ($1, 'E2E Native 连接', '[]'::jsonb, true, '[]'::jsonb, 'READY', NOW())`,
    [nativeBindingId],
  );
  await insertCredential(nativeBindingId, nativeClientId, nativeClientSecret);
});

async function insertCredential(
  credentialBindingId: string,
  clientId: string,
  clientSecret: string,
) {
  const id = randomUUID();
  await ownerPool.query(
    `INSERT INTO "UniversalConnectorCredential" (id, "bindingId", "clientId", "secretHash", "secretPrefix") VALUES ($1, $2, $3, $4, $5)`,
    [
      id,
      credentialBindingId,
      clientId,
      createHash("sha256").update(clientSecret).digest("base64url"),
      clientSecret.slice(0, 12),
    ],
  );
  return id;
}

test.afterAll(async () => {
  await ownerPool.query(
    `UPDATE "AuditLog" SET "externalActorId" = NULL WHERE "projectId" = $1`,
    [nativeProjectId],
  );
  await ownerPool.query(`DELETE FROM "Project" WHERE id = ANY($1::text[])`, [
    [projectId, nativeProjectId],
  ]);
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

test("管理员可在项目页查看状态驱动的接入指南", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("邮箱").fill("admin@local.test");
  await page.getByLabel("密码", { exact: true }).fill(password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.waitForURL(/\/staff\//);

  await page.goto(`/staff/projects/${projectId}`);
  await page.getByRole("tab", { name: "外部接入" }).click();
  await page.getByRole("button", { name: "接入指南" }).click();

  const guide = page.getByRole("dialog", { name: "Achord Connect 接入指南" });
  await expect(guide.getByText("当前下一步：生成 Client ID", { exact: false })).toBeVisible();
  await expect(guide.getByText("固定嵌入地址只是入口基地址")).toBeVisible();
  await guide.getByRole("tab", { name: "代码示例" }).click();
  await expect(
    guide.getByText("/api/v1/integrations/universal/launch-tickets", {
      exact: false,
    }),
  ).toBeVisible();
  await guide.getByRole("tab", { name: "产品边界" }).click();
  await expect(guide.getByText("原生 App 需要单独的 Native Launch 模式", { exact: false })).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await guide.evaluate((element) => element.scrollWidth <= element.clientWidth),
  ).toBe(true);
});

async function createLaunchPath(
  request: APIRequestContext,
  launchMode: "native" | "iframe" = "native",
) {
  const [clientId, clientSecret] =
    launchMode === "native"
      ? [nativeClientId, nativeClientSecret]
      : [iframeClientId, iframeClientSecret];
  const response = await request.post(
    "/api/v1/integrations/universal/launch-tickets",
    {
      headers: {
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      },
      data: {
        user: {
          id: launchMode === "native" ? nativeUserId : `iframe-${randomUUID()}`,
          name: "原生应用用户",
        },
        context:
          launchMode === "native"
            ? { launchMode: "native", locale: "zh-CN" }
            : { locale: "zh-CN" },
      },
    },
  );
  expect(response.status()).toBe(201);
  const { data } = (await response.json()) as { data: { launchUrl: string } };
  const url = new URL(data.launchUrl);
  expect(url.search).toBe("");
  expect(url.hash.includes("mode=native")).toBe(launchMode === "native");
  // APP_URL 可能与测试服务器地址不同，只取路径和片段
  return `${url.pathname}${url.hash}`;
}

async function staffRequestContext(browser: Browser) {
  const context = await browser.newContext();
  const staffPage = await context.newPage();
  await staffPage.goto("/login");
  await staffPage.getByLabel("邮箱").fill("admin@local.test");
  await staffPage.getByLabel("密码", { exact: true }).fill(password);
  await staffPage.getByRole("button", { name: "登录", exact: true }).click();
  await staffPage.waitForURL(/\/staff\//);
  return { context, staffPage };
}

test("Native Launch 顶层打开门户并正常收发消息，刷新后恢复会话", async ({
  page,
  request,
  browser,
}) => {
  const launchPath = await createLaunchPath(request);
  // 顶层打开：没有 referrer，也没有 ancestorOrigins
  await page.goto(launchPath);
  await expect(page).toHaveURL(`/embed/connect/${nativePublicId}`);
  const shell = page.getByTestId("external-embed-shell");
  await expect(shell).toBeVisible();
  await expect(page.getByRole("button", { name: "关闭" })).toBeVisible();

  const title = `Native 工单 ${Date.now()}`;
  await page.getByRole("button", { name: "新建服务请求" }).click();
  const dialog = page.getByRole("dialog", { name: "新建服务请求" });
  await dialog.getByLabel("标题").fill(title);
  await dialog.getByLabel("分类").click();
  await page.getByRole("option").first().click();
  await dialog.getByLabel("问题详情").fill("原生应用内提交的问题");
  await dialog.getByRole("button", { name: "创建" }).click();
  await expect(page.getByRole("heading", { name: title, level: 5 })).toBeVisible();

  await page.locator(".request-rich-editor").fill("来自原生窗口的回复");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.getByText("来自原生窗口的回复")).toBeVisible();

  const created = await ownerPool.query<{ id: string }>(
    `SELECT request.id FROM "ServiceRequest" request JOIN "ExternalContact" contact ON contact.id = request."createdByExternalContactId" WHERE contact."bindingId" = $1 AND request.title = $2`,
    [nativeBindingId, title],
  );
  const requestId = created.rows[0]?.id;
  expect(requestId).toBeTruthy();

  const { context: staffContext, staffPage } = await staffRequestContext(browser);
  try {
    const reply = await staffPage.request.post(
      `/api/v1/requests/${requestId}/messages`,
      { data: { body: "<p>员工端公开回复</p>", visibility: "CUSTOMER_VISIBLE" } },
    );
    expect(reply.ok()).toBe(true);
  } finally {
    await staffContext.close();
  }
  await expect(page.getByText("员工端公开回复")).toBeVisible({ timeout: 30_000 });

  // 片段已清掉，刷新靠 sessionStorage 恢复 native 会话
  await page.reload();
  await expect(page.getByText(title)).toBeVisible();
  await expect(page.getByRole("button", { name: "关闭" })).toBeVisible();
});

test("Native Launch 向 window.AchordConnectNative 发送门户事件", async ({
  page,
  request,
}) => {
  await page.addInitScript(() => {
    const events: Array<Record<string, unknown>> = [];
    (window as unknown as { __nativeEvents: typeof events }).__nativeEvents = events;
    (window as unknown as {
      AchordConnectNative: { postMessage: (message: string) => void };
    }).AchordConnectNative = {
      postMessage(message: string) {
        events.push(JSON.parse(message) as Record<string, unknown>);
      },
    };
  });
  const nativeEvents = () =>
    page.evaluate(
      () =>
        (window as unknown as { __nativeEvents: Array<Record<string, unknown>> })
          .__nativeEvents,
    );
  await page.goto(await createLaunchPath(request));
  await expect(page.getByTestId("external-embed-shell")).toBeVisible();
  await expect
    .poll(async () => (await nativeEvents()).map((event) => event.type))
    .toEqual(expect.arrayContaining(["ready", "unread-changed"]));
  const events = await nativeEvents();
  expect(events.every((event) => event.source === "achord-connect-v1")).toBe(true);
  expect(events.find((event) => event.type === "unread-changed")).toMatchObject({
    unreadCount: expect.any(Number),
  });
  expect(events.map((event) => event.type)).not.toContain("height");
  expect(JSON.stringify(events)).not.toContain("token");

  await page.getByRole("button", { name: "关闭" }).click();
  await expect
    .poll(async () => (await nativeEvents()).map((event) => event.type))
    .toContain("close-requested");
  // 有桥接时交给宿主关窗，页面本身不提示
  await expect(page.getByText("请直接关闭此窗口")).toHaveCount(0);

  // 撤销会话后刷新：从 sessionStorage 恢复的会话在首个请求上 401，
  // 发 session-expired 并明确提示
  await ownerPool.query(
    `UPDATE "ExternalEmbedSession" SET "revokedAt" = (now() AT TIME ZONE 'UTC') WHERE "bindingId" = $1 AND "revokedAt" IS NULL`,
    [nativeBindingId],
  );
  await page.reload();
  await expect(
    page.getByText("会话已过期，请关闭此窗口后从应用中重新打开工单。"),
  ).toBeVisible();
  await expect
    .poll(async () => (await nativeEvents()).map((event) => event.type))
    .toContain("session-expired");
  await expect(page.getByRole("button", { name: "关闭" })).toBeVisible();

  // 过期后会话缓存已删，再刷新仍按 native 提示，而不是 iframe 的「返回原系统」
  await page.reload();
  await expect(
    page.getByText("会话已过期，请关闭此窗口后从应用中重新打开工单。"),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "关闭" })).toBeVisible();
});

test("给 iframe 票据追加 mode=native 片段也不能绕过父页面来源校验", async ({
  page,
  request,
}) => {
  // 共享的 iframe 连接不预置凭据（接入指南用例依赖“尚未生成凭据”阶段），这里临时插入
  const credentialId = await insertCredential(
    bindingId,
    iframeClientId,
    iframeClientSecret,
  );
  let iframeLaunchPath = "";
  try {
    iframeLaunchPath = await createLaunchPath(request, "iframe");
  } finally {
    await ownerPool.query(
      `DELETE FROM "UniversalConnectorCredential" WHERE id = $1`,
      [credentialId],
    );
  }
  const ticket = new URLSearchParams(
    iframeLaunchPath.slice(iframeLaunchPath.indexOf("#") + 1),
  ).get("ticket")!;
  // 顶层打开 + 篡改片段：门户按 native 处理、不带 parentOrigin 去兑换，由服务端按票据拒绝。
  // 具体拒绝原因随环境不同（生产模式下 127.0.0.1 这个夹具 Origin 本身就不合法），
  // 这里只断言与环境无关的安全性质：没进门户、票据没被消耗。
  const exchangeResponse = page.waitForResponse("**/api/v1/embed/universal/exchange");
  await page.goto(`${iframeLaunchPath}&mode=native`);
  const exchange = await exchangeResponse;
  expect(exchange.request().postDataJSON()).toEqual({ publicId, ticket });
  expect(exchange.status()).toBeGreaterThanOrEqual(400);
  expect(exchange.status()).toBeLessThan(500);
  await expect(page).toHaveURL(`/embed/connect/${publicId}`);
  // Next 的路由播报器也是 role=alert，这里只认门户自己的错误提示框
  await expect(page.locator(".MuiAlert-colorError")).toBeVisible();
  await expect(page.getByTestId("external-embed-shell")).toHaveCount(0);
  const stored = await ownerPool.query<{ consumedAt: Date | null }>(
    `SELECT "consumedAt" FROM "UniversalLaunchTicket" WHERE "ticketHash" = $1`,
    [createHash("sha256").update(ticket).digest("base64url")],
  );
  expect(stored.rows).toHaveLength(1);
  expect(stored.rows[0].consumedAt).toBeNull();
});

test("iframe 模式不显示原生关闭按钮", async ({ page }) => {
  await mockUniversalApi(page);
  await page.goto(`/embed/connect/${publicId}#ticket=iframe-ticket`, {
    referer: "http://127.0.0.1:3000/third-party-host",
  });
  await expect(page.getByText("通用接入测试工单")).toBeVisible();
  await expect(page.getByRole("button", { name: "关闭" })).toHaveCount(0);
});
