import { expect, test, type Page } from "@playwright/test";

const publicId = "e2e-sub2api-public";

async function mockEmbedApi(page: Page) {
  await page.route("**/api/v1/embed/sub2api/exchange", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          token: "embed-session-token",
          expiresAt: "2026-07-17T14:00:00.000Z",
          contact: {
            id: "external-contact-1",
            externalUserId: "sub-user-1",
            name: "Sub2API 测试用户",
            email: "sub@example.com",
            username: "sub-user",
          },
          parentOrigins: ["http://127.0.0.1:3000"],
          project: {
            id: "external-project-1",
            title: "API 中转服务支持",
            status: "ACTIVE",
          },
        },
      }),
    }),
  );
  await page.route("**/api/v1/embed/requests", async (route) => {
    if (route.request().method() === "POST") {
      await route.fulfill({
        contentType: "application/json",
        status: 201,
        body: JSON.stringify({
          data: { id: "request-new", initialMessageId: "message-new" },
        }),
      });
      return;
    }
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          project: {
            id: "external-project-1",
            title: "API 中转服务支持",
            status: "ACTIVE",
            writable: true,
          },
          categories: [{ id: "category-1", name: "接口异常" }],
          requests: [
            {
              id: "request-1",
              number: "SR-20260717-001",
              title: "上游接口返回 502",
              description: "调用失败",
              priority: "HIGH",
              status: "IN_PROGRESS",
              createdAt: "2026-07-17T10:00:00.000Z",
              updatedAt: "2026-07-17T10:10:00.000Z",
              category: { id: "category-1", name: "接口异常" },
              unreadCount: 0,
            },
          ],
        },
      }),
    });
  });
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
  test(`Sub2API 嵌入门户 ${viewport.name} 布局与令牌清理`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await mockEmbedApi(page);
    await page.goto(
      `/embed/sub2api/${publicId}?user_id=sub-user-1&token=sensitive-jwt&src_host=sub.example.com`,
    );

    await expect(page.getByText("API 中转服务支持").first()).toBeVisible();
    await expect(page.getByText("上游接口返回 502")).toBeVisible();
    await expect(page).toHaveURL(`/embed/sub2api/${publicId}`);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);

    await page.getByRole("button", { name: "新建工单" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  });
}
