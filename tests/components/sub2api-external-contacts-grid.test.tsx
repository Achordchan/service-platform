// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "@mui/material/styles";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ExternalContact } from "@/components/staff/external-contact-grid";
import { ExternalContactsPanel } from "@/components/staff/sub2api-integration-panel";
import { appTheme } from "@/theme/theme";
import { AppConfirmProvider } from "@/components/shared/confirm-provider";
import { Sub2ApiIntegrationPanel } from "@/components/staff/sub2api-integration-panel";

const staffApiMock = vi.hoisted(() => vi.fn());
const jsonRequestMock = vi.hoisted(() =>
  vi.fn((method: string, body: unknown) => ({ method, json: body })),
);

vi.mock("@/components/staff/staff-api", () => ({
  jsonRequest: jsonRequestMock,
  staffApi: staffApiMock,
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function createContact(
  overrides: Partial<ExternalContact> = {},
): ExternalContact {
  return {
    id: "contact-1",
    externalUserId: "external-user-1",
    email: "customer@example.test",
    username: "customer-name",
    displayName: "外部客户一",
    avatarUrl: null,
    profileAttributes: { company: "测试公司" },
    sourceKey: "sub2api",
    sourceLabel: "Sub2API",
    status: "ACTIVE",
    firstSeenAt: "2026-07-31T08:00:00.000Z",
    lastSeenAt: "2026-08-01T08:00:00.000Z",
    _count: { requestsCreated: 3 },
    ...overrides,
  };
}

function renderPanel() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return render(
    <ThemeProvider theme={appTheme}>
      <QueryClientProvider client={queryClient}>
        <ExternalContactsPanel projectId="project-1" />
      </QueryClientProvider>
    </ThemeProvider>,
  );
}

describe("Sub2API 外部联系人 DataGrid", () => {
  it("展示核心字段并保留联系人详情弹窗", async () => {
    const contact = createContact();
    staffApiMock.mockResolvedValue({ items: [contact], nextCursor: null });
    renderPanel();

    expect(
      await screen.findByRole("grid", { name: "外部联系人" }),
    ).toBeTruthy();
    expect(screen.getByText(contact.displayName)).toBeTruthy();
    expect(screen.getByText(contact.externalUserId)).toBeTruthy();
    expect(screen.getByText(contact.email as string)).toBeTruthy();
    expect(screen.getByText("正常")).toBeTruthy();
    expect(screen.getByText("3")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "查看资料" }));

    expect(await screen.findByRole("dialog")).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: "外部联系人资料" }),
    ).toBeTruthy();
    expect(screen.getByText("测试公司")).toBeTruthy();
  });

  it("停用联系人继续调用原 PATCH 接口并刷新查询", async () => {
    const contact = createContact();
    staffApiMock.mockImplementation((url: string) => {
      if (url.endsWith(`/external-contacts/${contact.id}`)) {
        return Promise.resolve(undefined);
      }
      return Promise.resolve({ items: [contact], nextCursor: null });
    });
    renderPanel();

    fireEvent.click(await screen.findByRole("button", { name: "停用" }));

    await waitFor(() =>
      expect(staffApiMock).toHaveBeenCalledWith(
        `/api/v1/projects/project-1/external-contacts/${contact.id}`,
        { method: "PATCH", json: { status: "BLOCKED" } },
      ),
    );
    await waitFor(() =>
      expect(
        staffApiMock.mock.calls.filter(([url]) =>
          String(url).includes("/external-contacts?limit=50"),
        ).length,
      ).toBeGreaterThan(1),
    );
  });

  it("恢复已停用联系人时提交 ACTIVE 状态", async () => {
    const contact = createContact({ status: "BLOCKED" });
    staffApiMock.mockImplementation((url: string) => {
      if (url.endsWith(`/external-contacts/${contact.id}`)) {
        return Promise.resolve(undefined);
      }
      return Promise.resolve({ items: [contact], nextCursor: null });
    });
    renderPanel();

    fireEvent.click(await screen.findByRole("button", { name: "恢复" }));

    await waitFor(() =>
      expect(staffApiMock).toHaveBeenCalledWith(
        `/api/v1/projects/project-1/external-contacts/${contact.id}`,
        { method: "PATCH", json: { status: "ACTIVE" } },
      ),
    );
  });

  it("关键词和状态仍作为服务端查询参数发送", async () => {
    staffApiMock.mockResolvedValue({
      items: [createContact()],
      nextCursor: null,
    });
    renderPanel();
    await screen.findByRole("grid", { name: "外部联系人" });

    fireEvent.change(
      screen.getByPlaceholderText("搜索姓名、邮箱、用户名或外部 ID"),
      { target: { value: "alice" } },
    );
    await waitFor(() =>
      expect(staffApiMock).toHaveBeenCalledWith(
        expect.stringContaining("limit=50&q=alice"),
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      ),
    );

    fireEvent.mouseDown(screen.getByRole("combobox", { name: "状态" }));
    fireEvent.click(await screen.findByRole("option", { name: "已停用" }));

    await waitFor(() =>
      expect(staffApiMock).toHaveBeenCalledWith(
        expect.stringContaining("limit=50&q=alice&status=BLOCKED"),
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      ),
    );
  });

  it("加载下一游标后保留已有联系人和服务端顺序", async () => {
    const first = createContact();
    const second = createContact({
      id: "contact-2",
      externalUserId: "external-user-2",
      displayName: "外部客户二",
      email: null,
      username: "second-user",
    });
    staffApiMock.mockImplementation((url: string) =>
      Promise.resolve(
        url.includes("cursor=cursor-2")
          ? { items: [second], nextCursor: null }
          : { items: [first], nextCursor: "cursor-2" },
      ),
    );
    renderPanel();

    expect(await screen.findByText(first.displayName)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "加载更多" }));

    expect(await screen.findByText(second.displayName)).toBeTruthy();
    expect(screen.getByText(first.displayName)).toBeTruthy();
    expect(staffApiMock).toHaveBeenCalledWith(
      expect.stringContaining("limit=50&cursor=cursor-2"),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("空结果使用 DataGrid 的统一空状态", async () => {
    staffApiMock.mockResolvedValue({ items: [], nextCursor: null });
    renderPanel();

    expect(
      await screen.findByRole("grid", { name: "外部联系人" }),
    ).toBeTruthy();
    expect(screen.getByText("暂无外部联系人")).toBeTruthy();
  });
});

describe("Sub2API 集成查询缓存", () => {
  it("状态更新成功后即使刷新失败也立即显示新状态", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const connection = {
      bindingId: "binding-1",
      publicId: "public-1",
      bindingStatus: "DRAFT" as const,
      baseUrl: "https://sub2api.example.test",
      sourceOrigin: "https://sub2api.example.test",
      hasAdminApiKey: true,
      emailNotificationsEnabled: true,
      customerMemberNotificationsEnabled: false,
      healthStatus: "READY",
      lastCheckedAt: null,
      lastError: null,
      iframeUrl: "https://service.example.test/embed/sub2api/public-1",
    };
    let integrationLoads = 0;
    staffApiMock.mockImplementation((url: string, options?: { method?: string }) => {
      if (url.endsWith("/integrations/sub2api") && options?.method === "PATCH") {
        return Promise.resolve({ ...connection, bindingStatus: "ACTIVE" });
      }
      integrationLoads += 1;
      return integrationLoads === 1
        ? Promise.resolve({
            plugin: { enabled: true, healthStatus: "READY", lastError: null },
            connection,
          })
        : Promise.reject(new Error("刷新失败"));
    });

    render(
      <ThemeProvider theme={appTheme}>
        <QueryClientProvider client={queryClient}>
          <AppConfirmProvider>
            <Sub2ApiIntegrationPanel projectId="project-1" canEdit />
          </AppConfirmProvider>
        </QueryClientProvider>
      </ThemeProvider>,
    );

    fireEvent.click(await screen.findByRole("button", { name: "激活" }));

    await waitFor(() => expect(screen.getByText("已启用")).toBeTruthy());
  });
});
