import {
  expect,
  test,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { loadE2EEnv } from "./load-e2e-env";

loadE2EEnv();

const password = "ServiceDemo!2026";
const ownerPool = new Pool({
  connectionString: process.env.DATABASE_MIGRATION_URL,
  max: 1,
});
const createdRequestIds: string[] = [];
let unassignedRequestId: string | null = null;
let unassignedRequestTitle = "";
let adminContext: BrowserContext;
let customerContext: BrowserContext;
let technicianContext: BrowserContext;
let adminPage: Page;
let customerPage: Page;
let technicianPage: Page;
let previousPluginState: {
  enabled: boolean;
  healthStatus: string;
  lastCheckedAt: Date | null;
  lastError: string | null;
} | null = null;
let pluginTestStartedAt: Date | null = null;

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("密码").fill(password);
  await page.getByRole("button", { name: "登录" }).click();
  await page.waitForURL(/\/(staff|customer)\//);
}

async function expectVisibleText(page: Page, text: string) {
  await expect(
    page.getByText(text).and(page.locator(":visible")).first(),
  ).toBeVisible();
}

test.describe("主流程冒烟", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async ({ browser }) => {
    adminContext = await browser.newContext();
    customerContext = await browser.newContext();
    technicianContext = await browser.newContext();
    adminPage = await adminContext.newPage();
    customerPage = await customerContext.newPage();
    technicianPage = await technicianContext.newPage();

    await login(adminPage, "admin@local.test");
    await login(customerPage, "client@local.test");
    await login(technicianPage, "tech@local.test");

    unassignedRequestTitle = `E2E 未分配请求 ${Date.now()}`;
    unassignedRequestId = randomUUID();
    const seedProject = await ownerPool.query<{
      projectId: string;
      categoryId: string;
      createdById: string;
    }>(
      `
        SELECT
          project.id AS "projectId",
          category.id AS "categoryId",
          client.id AS "createdById"
        FROM "Project" project
        JOIN "ServiceType" service_type ON service_type.id = project."serviceTypeId"
        JOIN "RequestCategory" category
          ON category."serviceTypeId" = service_type.id
         AND category.active = true
        JOIN "User" client ON client.email = 'client@local.test'
        WHERE project.title = '官网 SEO 优化服务'
        ORDER BY category.name ASC, category.id ASC
        LIMIT 1
      `,
    );
    const projectRow = seedProject.rows[0];
    if (!projectRow) {
      throw new Error(
        "缺少 seed 项目「官网 SEO 优化服务」或客户账号，请先 pnpm test:integration:prepare",
      );
    }
    await ownerPool.query(
      `
        INSERT INTO "ServiceRequest" (
          id,
          number,
          title,
          description,
          priority,
          status,
          "projectId",
          "categoryId",
          "createdById",
          "assigneeId",
          "createdAt",
          "updatedAt"
        )
        VALUES (
          $1,
          $2,
          $3,
          $4,
          'NORMAL',
          'PENDING',
          $5,
          $6,
          $7,
          NULL,
          NOW(),
          NOW()
        )
      `,
      [
        unassignedRequestId,
        `E2E-UNASSIGNED-${Date.now()}`,
        unassignedRequestTitle,
        "E2E 自建未分配请求，不依赖开发库历史数据。",
        projectRow.projectId,
        projectRow.categoryId,
        projectRow.createdById,
      ],
    );
    createdRequestIds.push(unassignedRequestId);
  });

  test.afterAll(async () => {
    await Promise.all([
      adminContext.close(),
      customerContext.close(),
      technicianContext.close(),
    ]);
    if (createdRequestIds.length > 0) {
      await ownerPool.query(
        `
          DELETE FROM "AuditLog"
          WHERE "serviceRequestId" = ANY($1::text[])
            OR "resourceId" = ANY($1::text[])
        `,
        [createdRequestIds],
      );
      await ownerPool.query(
        `
          DELETE FROM "EventRecord"
          WHERE "serviceRequestId" = ANY($1::text[])
        `,
        [createdRequestIds],
      );
      await ownerPool.query(
        'DELETE FROM "ServiceRequest" WHERE id = ANY($1::text[])',
        [createdRequestIds],
      );
    }
    if (previousPluginState) {
      await ownerPool.query(
        `
          UPDATE "PluginInstallation"
          SET
            enabled = $2,
            "healthStatus" = $3,
            "lastCheckedAt" = $4,
            "lastError" = $5,
            "updatedAt" = NOW()
          WHERE "key" = $1
        `,
        [
          "image-webp",
          previousPluginState.enabled,
          previousPluginState.healthStatus,
          previousPluginState.lastCheckedAt,
          previousPluginState.lastError,
        ],
      );
    }
    if (pluginTestStartedAt) {
      await ownerPool.query(
        `
          DELETE FROM "AuditLog"
          WHERE "resourceType" = 'PluginInstallation'
            AND "resourceId" = 'image-webp'
            AND "createdAt" >= $1
        `,
        [pluginTestStartedAt],
      );
      await ownerPool.query(
        `
          DELETE FROM "EventRecord"
          WHERE type = 'PLUGIN_RUN_UPDATED'
            AND payload ->> 'pluginKey' = 'image-webp'
            AND "createdAt" >= $1
        `,
        [pluginTestStartedAt],
      );
    }
    await ownerPool.end();
  });

  test("管理员可进入项目、客户与服务请求后台", async () => {
    await expect(
      adminPage.getByRole("heading", { name: "项目", exact: true }),
    ).toBeVisible();
    await expectVisibleText(adminPage, "官网 SEO 优化服务");

    await adminPage.getByRole("link", { name: "客户", exact: true }).click();
    await expect(
      adminPage.getByRole("heading", { name: "客户", exact: true }),
    ).toBeVisible();
    await expect(
      adminPage.getByRole("button", { name: "新建客户" }),
    ).toBeVisible();

    await adminPage
      .getByRole("link", { name: "服务请求", exact: true })
      .click();
    await expect(
      adminPage.getByRole("heading", { name: "服务请求" }),
    ).toBeVisible();
    const advancedFilterButton = adminPage.getByRole("button", {
      name: /^更多筛选/,
    });
    await expect(advancedFilterButton).toBeVisible();
    expect((await advancedFilterButton.boundingBox())?.height).toBeLessThanOrEqual(
      44,
    );

    await adminPage
      .getByRole("link", { name: "插件中心", exact: true })
      .click();
    await expect(
      adminPage.getByRole("heading", { name: "插件中心", exact: true }),
    ).toBeVisible();
    const pluginCard = adminPage.getByRole("button", {
      name: "管理图片 WebP 优化",
    });
    await expect(pluginCard).toBeVisible();
    const pluginCardBox = await pluginCard.boundingBox();
    expect(pluginCardBox?.width).toBeLessThanOrEqual(300);
    expect(pluginCardBox?.height).toBeLessThanOrEqual(260);
    const currentPluginState = await ownerPool.query<{
      enabled: boolean;
      healthStatus: string;
      lastCheckedAt: Date | null;
      lastError: string | null;
    }>(
      `
        SELECT
          enabled,
          "healthStatus",
          "lastCheckedAt",
          "lastError"
        FROM "PluginInstallation"
        WHERE "key" = 'image-webp'
      `,
    );
    previousPluginState = currentPluginState.rows[0] ?? null;
    pluginTestStartedAt = new Date();
    await ownerPool.query(
      `
        UPDATE "PluginInstallation"
        SET
          enabled = false,
          "healthStatus" = 'UNKNOWN',
          "lastCheckedAt" = NULL,
          "lastError" = NULL,
          "updatedAt" = NOW()
        WHERE "key" = 'image-webp'
      `,
    );
    await adminPage.reload();
    await adminPage
      .getByRole("button", { name: "管理图片 WebP 优化" })
      .click();
    await adminPage.getByRole("button", { name: "运行环境检测" }).click();
    await expect(adminPage.getByText("运行环境检测通过")).toBeVisible();
    await adminPage.getByRole("button", { name: "启用插件" }).click();
    await expect(adminPage.getByText("插件已启用")).toBeVisible();
    await adminPage.getByRole("button", { name: "停用插件" }).click();
    await expect(adminPage.getByText("插件已停用")).toBeVisible();
    await adminPage.getByRole("button", { name: "关闭" }).click();
    const pluginGuideButton = adminPage.getByRole("button", {
      name: "插件开发规范",
    });
    await expect(pluginGuideButton).toBeVisible();
    await pluginGuideButton.click();
    await expect(
      adminPage.getByRole("dialog", { name: "插件开发规范" }),
    ).toBeVisible();
    await expect(
      adminPage.getByRole("tab", { name: "开发流程" }),
    ).toBeVisible();
    await expect(
      adminPage.getByRole("tab", { name: "权限边界" }),
    ).toBeVisible();
    await expect(
      adminPage.getByRole("tab", { name: "发布验收" }),
    ).toBeVisible();
    await adminPage.getByRole("button", { name: "关闭" }).click();

    await adminPage.setViewportSize({ width: 390, height: 844 });
    await pluginGuideButton.click();
    await adminPage.getByRole("tab", { name: "发布验收" }).click();
    const pluginPageHasHorizontalOverflow = await adminPage.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 1,
    );
    expect(pluginPageHasHorizontalOverflow).toBe(false);
    await adminPage.getByRole("button", { name: "关闭" }).click();
    await adminPage.setViewportSize({ width: 1280, height: 720 });

    await adminPage.goto("/staff/settings");
    await expect(
      adminPage.getByRole("heading", { name: "设置", exact: true }),
    ).toBeVisible();

    const mailTemplates = adminPage.getByRole("button", {
      name: /邮件模板/,
    });
    const roleGroups = adminPage.getByRole("button", {
      name: /角色与权限/,
    });
    await expect(mailTemplates).toHaveAttribute("aria-expanded", "false");
    await expect(roleGroups).toHaveAttribute("aria-expanded", "false");
    await expect(
      adminPage.getByRole("button", { name: "编辑" }),
    ).not.toBeVisible();
    await expect(
      adminPage.getByRole("button", { name: "新增角色组" }),
    ).not.toBeVisible();

    await mailTemplates.click();
    await expect(mailTemplates).toHaveAttribute("aria-expanded", "true");
    await expect(
      adminPage.getByRole("button", { name: "编辑" }).first(),
    ).toBeVisible();
    await mailTemplates.click();

    await roleGroups.click();
    await expect(roleGroups).toHaveAttribute("aria-expanded", "true");
    await expect(
      adminPage.getByRole("button", { name: "新增角色组" }),
    ).toBeVisible();
    await roleGroups.click();

    await adminPage.setViewportSize({ width: 390, height: 844 });
    const hasHorizontalOverflow = await adminPage.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 1,
    );
    expect(hasHorizontalOverflow).toBe(false);
  });

  test("客户可查看服务项目与请求列表", async () => {
    await expect(
      customerPage.getByRole("heading", {
        name: "服务项目",
        exact: true,
      }),
    ).toBeVisible();
    await expectVisibleText(customerPage, "官网 SEO 优化服务");

    const projectId = await customerPage.evaluate(async () => {
      const response = await fetch("/api/v1/projects");
      const payload = (await response.json()) as {
        data: Array<{ id: string; title: string }>;
      };
      return payload.data.find((item) => item.title === "官网 SEO 优化服务")
        ?.id;
    });
    if (!projectId) throw new Error("缺少 E2E 客户项目编号");

    await customerPage.route("**/api/v1/notifications", async (route) => {
      await route.fulfill({
        json: {
          data: [
            {
              id: "e2e-customer-project-update",
              type: "PROJECT_UPDATE",
              title: "项目动态已更新",
              body: "E2E 项目动态",
              readAt: null,
              projectId,
              serviceRequestId: null,
              occurrenceCount: 1,
              createdAt: "2026-07-18T00:00:00.000Z",
              updatedAt: "2026-07-18T00:00:00.000Z",
            },
          ],
        },
      });
    });
    try {
      await customerPage.reload();
      await expect(
        customerPage.locator(
          `a[href="/customer/projects/${projectId}"][aria-label="官网 SEO 优化服务，有未读更新"]`,
        ),
      ).toBeVisible();
    } finally {
      await customerPage.unroute("**/api/v1/notifications");
    }

    await customerPage.goto("/customer/requests");
    await expect(
      customerPage.getByRole("heading", { name: "服务请求" }),
    ).toBeVisible();
    await expectVisibleText(customerPage, "关于首页标题优化建议");
  });

  test("项目设置可控制客户中心模块", async () => {
    const projectResult = await ownerPool.query<{
      id: string;
      customerUpdatesEnabled: boolean;
      customerRequestsEnabled: boolean;
      customerFilesEnabled: boolean;
    }>(
      `
        SELECT
          id,
          "customerUpdatesEnabled",
          "customerRequestsEnabled",
          "customerFilesEnabled"
        FROM "Project"
        WHERE title = '官网 SEO 优化服务'
        LIMIT 1
      `,
    );
    const project = projectResult.rows[0];
    if (!project) throw new Error("缺少 E2E 项目");

    try {
      await adminPage.setViewportSize({ width: 390, height: 844 });
      await adminPage.goto(`/staff/projects/${project.id}`);
      await adminPage.getByRole("button", { name: "项目设置" }).click();
      const settingsDialog = adminPage.getByRole("dialog", {
        name: "项目设置",
      });
      await expect(
        settingsDialog.getByRole("switch", { name: "客户显示整体进度条" }),
      ).toBeVisible();
      await expect(
        settingsDialog.getByRole("switch", { name: "客户显示里程碑模块" }),
      ).toBeVisible();
      await expect(
        settingsDialog.getByRole("switch", { name: "客户显示进度动态" }),
      ).toBeVisible();
      await expect(
        settingsDialog.getByRole("switch", { name: "客户显示服务请求" }),
      ).toBeVisible();
      await expect(
        settingsDialog.getByRole("switch", { name: "客户显示文件资料" }),
      ).toBeVisible();
      expect(
        await adminPage.evaluate(
          () => document.documentElement.scrollWidth > window.innerWidth + 1,
        ),
      ).toBe(false);
      await settingsDialog.getByRole("button", { name: "取消" }).click();

      await ownerPool.query(
        `
          UPDATE "Project"
          SET
            "customerUpdatesEnabled" = false,
            "customerRequestsEnabled" = false,
            "customerFilesEnabled" = false,
            "updatedAt" = NOW()
          WHERE id = $1
        `,
        [project.id],
      );

      await customerPage.setViewportSize({ width: 390, height: 844 });
      await customerPage.goto(`/customer/projects/${project.id}?tab=updates`);
      await expect(customerPage.getByText("交付概况")).toBeVisible();
      await expect(
        customerPage.getByRole("tab", { name: /进度动态/ }),
      ).not.toBeVisible();
      await expect(
        customerPage.getByRole("tab", { name: /服务请求/ }),
      ).not.toBeVisible();
      await expect(
        customerPage.getByRole("tab", { name: /文件资料/ }),
      ).not.toBeVisible();
      await expect(
        customerPage.getByRole("link", { name: "提交服务请求" }),
      ).not.toBeVisible();
      await expect(customerPage.getByText("最新进度")).not.toBeVisible();
      await expect(customerPage.getByText("最近服务请求")).not.toBeVisible();
      expect(
        await customerPage.evaluate(
          () => document.documentElement.scrollWidth > window.innerWidth + 1,
        ),
      ).toBe(false);

      await adminPage.setViewportSize({ width: 1280, height: 720 });
      await adminPage.goto(`/staff/projects/${project.id}`);
      await expect(
        adminPage.getByRole("tab", { name: /进度动态/ }),
      ).toBeVisible();
      await expect(
        adminPage.getByRole("tab", { name: /服务请求/ }),
      ).toBeVisible();
      await expect(
        adminPage.getByRole("tab", { name: /文件资料/ }),
      ).toBeVisible();
    } finally {
      await ownerPool.query(
        `
          UPDATE "Project"
          SET
            "customerUpdatesEnabled" = $2,
            "customerRequestsEnabled" = $3,
            "customerFilesEnabled" = $4,
            "updatedAt" = NOW()
          WHERE id = $1
        `,
        [
          project.id,
          project.customerUpdatesEnabled,
          project.customerRequestsEnabled,
          project.customerFilesEnabled,
        ],
      );
      if (!adminPage.isClosed()) {
        await adminPage.setViewportSize({ width: 1280, height: 720 });
      }
      if (!customerPage.isClosed()) {
        await customerPage.setViewportSize({ width: 1280, height: 720 });
      }
    }
  });

  test("导航未读红点仅在离开对应栏目时显示", async () => {
    await adminPage.setViewportSize({ width: 1280, height: 720 });
    await adminPage.route("**/api/v1/notifications", async (route) => {
      await route.fulfill({
        json: {
          data: [
            {
              id: "e2e-project-notification",
              type: "PROJECT_UPDATE",
              title: "项目动态已更新",
              body: "E2E 项目动态",
              readAt: null,
              projectId: "e2e-project",
              serviceRequestId: null,
              occurrenceCount: 1,
              createdAt: "2026-07-18T00:00:00.000Z",
              updatedAt: "2026-07-18T00:00:00.000Z",
            },
            {
              id: "e2e-request-notification",
              type: "REQUEST_MESSAGE",
              title: "服务请求有新回复",
              body: "E2E 服务请求回复",
              readAt: null,
              projectId: "e2e-project",
              serviceRequestId: "e2e-request",
              occurrenceCount: 1,
              createdAt: "2026-07-18T00:00:00.000Z",
              updatedAt: "2026-07-18T00:00:00.000Z",
            },
          ],
        },
      });
    });

    try {
      await adminPage.goto("/staff/projects");
      await expect(
        adminPage.getByRole("link", { name: "项目", exact: true }),
      ).toBeVisible();
      await expect(
        adminPage.getByRole("link", {
          name: "服务请求，有未读更新",
          exact: true,
        }),
      ).toBeVisible();

      await adminPage.goto("/staff/customers");
      await expect(
        adminPage.getByRole("link", {
          name: "项目，有未读更新",
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        adminPage.getByRole("link", {
          name: "服务请求，有未读更新",
          exact: true,
        }),
      ).toBeVisible();

      await adminPage
        .getByRole("button", { name: "收起侧栏" })
        .click({ force: true });
      expect(
        await adminPage.evaluate(
          () => document.documentElement.scrollWidth > window.innerWidth + 1,
        ),
      ).toBe(false);
      await adminPage.setViewportSize({ width: 390, height: 844 });
      await adminPage.getByRole("button", { name: "打开导航" }).click();
      await expect(
        adminPage.getByRole("link", {
          name: "项目，有未读更新",
          exact: true,
        }),
      ).toBeVisible();
      expect(
        await adminPage.evaluate(
          () => document.documentElement.scrollWidth > window.innerWidth + 1,
        ),
      ).toBe(false);
    } finally {
      await adminPage.unroute("**/api/v1/notifications");
      await adminPage.setViewportSize({ width: 1280, height: 720 });
      await adminPage.reload();
    }
  });

  test("技术人员可进入已分配和未分配请求列表", async () => {
    await technicianPage.goto("/staff/requests");
    await expect(
      technicianPage.getByRole("heading", { name: "服务请求" }),
    ).toBeVisible();
    await expectVisibleText(technicianPage, "关于首页标题优化建议");
    await expectVisibleText(technicianPage, unassignedRequestTitle);

    await technicianPage.goto("/staff/plugins");
    await technicianPage.waitForURL("/staff/projects");
    await expect(
      technicianPage.getByRole("heading", { name: "项目", exact: true }),
    ).toBeVisible();
  });

  test("请求在线提示、自动接手和回复引用保持实时同步", async () => {
    const created = await customerPage.evaluate(async () => {
      const projectsResponse = await fetch("/api/v1/projects");
      const projectsPayload = (await projectsResponse.json()) as {
        data: Array<{
          id: string;
          title: string;
          serviceType: {
            requestCategories: Array<{ id: string }>;
          };
        }>;
      };
      const project = projectsPayload.data.find(
        (item) => item.title === "官网 SEO 优化服务",
      );
      const categoryId = project?.serviceType.requestCategories[0]?.id;
      if (!project || !categoryId) throw new Error("缺少 E2E 请求项目");
      const title = `E2E 在线回复 ${Date.now()}`;
      const response = await fetch(`/api/v1/projects/${project.id}/requests`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          description: "<p>E2E 初始请求描述</p>",
          categoryId,
          priority: "NORMAL",
        }),
      });
      const payload = (await response.json()) as {
        data: { id: string; title: string };
      };
      if (!response.ok) throw new Error("创建 E2E 请求失败");
      return payload.data;
    });
    createdRequestIds.push(created.id);

    await Promise.all([
      customerPage.goto(`/customer/requests/${created.id}`),
      technicianPage.goto(`/staff/requests/${created.id}`),
    ]);

    await expect(customerPage.getByText("服务人员在线")).toBeVisible();
    await expect(technicianPage.getByText("客户在线")).toBeVisible();
    await expect(customerPage.getByText("E2E 初始请求描述")).toBeVisible();
    await expect(technicianPage.getByText("E2E 初始请求描述")).toBeVisible();

    await technicianPage
      .locator(".request-rich-editor")
      .fill("E2E 后台公开回复");
    await expect(customerPage.getByText("服务人员正在输入")).toBeVisible();
    await technicianPage
      .getByRole("button", { name: "回复并接手" })
      .click();

    await expect(customerPage.getByText("E2E 后台公开回复")).toBeVisible();
    await expect(
      customerPage.getByText("李工程师 已接手此请求"),
    ).toBeVisible();

    const staffMessage = customerPage.getByText("E2E 后台公开回复");
    await staffMessage.hover();
    await customerPage
      .getByRole("button", { name: "回复 李工程师 的消息" })
      .click();
    await expect(customerPage.getByText("回复 李工程师")).toBeVisible();

    await simulatePageVisibility(technicianPage, "hidden");
    await expect(customerPage.getByText("服务人员在线")).toBeVisible();

    await customerPage
      .locator(".request-rich-editor")
      .fill("E2E 客户引用回复");
    await expect(technicianPage.getByText("客户正在输入")).toBeVisible();
    await customerPage.locator('input[type="file"]').setInputFiles({
      name: "e2e-chat-image.png",
      mimeType: "image/png",
      buffer: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
        "base64",
      ),
    });
    await expect(customerPage.getByText("待发送附件")).toBeVisible();
    await customerPage.getByRole("button", { name: "发送回复" }).click();

    await expect(
      technicianPage.getByText("E2E 客户引用回复"),
    ).toBeVisible();
    await expect(
      technicianPage.locator('img[alt="e2e-chat-image.png"]'),
    ).toBeVisible();
    await expect(
      technicianPage.getByText("E2E 后台公开回复"),
    ).toHaveCount(2);
    await expect
      .poll(() => technicianPage.title())
      .toMatch(/^【新消息】/);
    await simulatePageVisibility(technicianPage, "visible");
    await expect
      .poll(() => technicianPage.title())
      .not.toMatch(/^【新消息】/);

    const unreadForRequest = await technicianPage.evaluate(
      async (requestId) => {
        const response = await fetch("/api/v1/notifications", {
          cache: "no-store",
        });
        const payload = (await response.json()) as {
          data: Array<{
            serviceRequestId?: string | null;
            readAt?: string | null;
          }>;
        };
        return payload.data.filter(
          (item) => item.serviceRequestId === requestId && !item.readAt,
        ).length;
      },
      created.id,
    );
    expect(unreadForRequest).toBe(0);

    await customerPage.setViewportSize({ width: 390, height: 844 });
    await expect(customerPage.getByText("服务人员在线")).toBeVisible();
    const hasHorizontalOverflow = await customerPage.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 1,
    );
    expect(hasHorizontalOverflow).toBe(false);
  });
});

async function simulatePageVisibility(
  page: Page,
  state: "visible" | "hidden",
) {
  await page.evaluate((nextState) => {
    if (nextState === "hidden") {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => "hidden",
      });
      Object.defineProperty(document, "hidden", {
        configurable: true,
        get: () => true,
      });
      Object.defineProperty(document, "hasFocus", {
        configurable: true,
        value: () => false,
      });
    } else {
      const documentOverrides = document as unknown as Record<
        string,
        unknown
      >;
      delete documentOverrides.visibilityState;
      delete documentOverrides.hidden;
      delete documentOverrides.hasFocus;
    }
    document.dispatchEvent(new Event("visibilitychange"));
    if (nextState === "visible") {
      window.dispatchEvent(new Event("focus"));
    }
  }, state);
}
