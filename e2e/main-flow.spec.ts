import { expect, test, type Page } from "@playwright/test";

const password = "ServiceDemo!2026";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("密码").fill(password);
  await page.getByRole("button", { name: "登录" }).click();
  await page.waitForURL(/\/(staff|customer)\//);
}

async function expectVisibleText(page: Page, text: string) {
  await expect(page.getByText(text).and(page.locator(":visible")).first()).toBeVisible();
}

test.describe("主流程冒烟", () => {
  test("管理员可进入项目、客户与服务请求后台", async ({ page }) => {
    await login(page, "admin@local.test");
    await expect(page.getByRole("heading", { name: "项目管理" })).toBeVisible();
    await expectVisibleText(page, "官网 SEO 优化服务");

    await page.getByRole("link", { name: "客户", exact: true }).click();
    await expect(page.getByRole("heading", { name: "客户空间" })).toBeVisible();
    await expect(page.getByRole("button", { name: "新建客户" })).toBeVisible();

    await page.getByRole("link", { name: "服务请求", exact: true }).click();
    await expect(page.getByRole("heading", { name: "服务请求" })).toBeVisible();
  });

  test("客户可查看服务项目与请求列表", async ({ page }) => {
    await login(page, "client@local.test");
    await expect(page.getByRole("heading", { name: "我的服务" })).toBeVisible();
    await expectVisibleText(page, "官网 SEO 优化服务");

    await page.goto("/customer/requests");
    await expect(page.getByRole("heading", { name: "我的工单" })).toBeVisible();
    await expectVisibleText(page, "关于首页标题优化建议");
  });

  test("技术人员可进入已分配请求列表", async ({ page }) => {
    await login(page, "tech@local.test");
    await page.goto("/staff/requests");
    await expect(page.getByRole("heading", { name: "服务请求" })).toBeVisible();
    await expectVisibleText(page, "关于首页标题优化建议");
  });
});
