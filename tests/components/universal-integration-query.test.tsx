// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UniversalIntegrationPanel } from "@/components/staff/universal-integration-panel";
import { ToastProvider } from "@/components/shared/toast-provider";
import { queryKeys } from "@/lib/query-keys";
import { jsonRequest } from "@/components/staff/staff-api";

const staffApiMock = vi.hoisted(() => vi.fn());

vi.mock("@/components/staff/staff-api", () => ({
  jsonRequest: vi.fn(),
  staffApi: staffApiMock,
}));

function integrationView(name: string) {
  return {
    plugin: { enabled: true, healthStatus: "READY", lastError: null },
    project: { id: "project-1", title: "项目名称" },
    connection: {
      bindingId: "binding-1",
      publicId: "public-1",
      bindingStatus: "ACTIVE",
      name,
      allowedOrigins: ["https://app.example.com"],
      allowNativeLaunch: false,
      profileFields: [],
      emailNotificationsEnabled: true,
      customerMemberNotificationsEnabled: false,
      webhookUrl: null,
      webhookEvents: [],
      hasWebhookSecret: false,
      webhookStatus: "IDLE",
      healthStatus: "READY",
      lastCheckedAt: null,
      lastError: null,
      embedUrl: "https://support.example.com/embed/connect/public-1",
      activeCredentialCount: 0,
      credentials: [],
    },
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Universal 集成查询缓存", () => {
  it("缓存刷新不会覆盖未保存的本地草稿", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    staffApiMock.mockResolvedValue(integrationView("服务器名称"));

    render(
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <UniversalIntegrationPanel projectId="project-1" canEdit />
        </ToastProvider>
      </QueryClientProvider>,
    );

    const nameInput = await screen.findByLabelText("连接名称");
    fireEvent.change(nameInput, { target: { value: "未保存名称" } });
    expect((nameInput as HTMLInputElement).value).toBe("未保存名称");

    act(() => {
      queryClient.setQueryData(
        queryKeys.universal.integration("project-1"),
        integrationView("缓存中的新名称"),
      );
    });

    await waitFor(() =>
      expect((nameInput as HTMLInputElement).value).toBe("未保存名称"),
    );
  });

  it("凭据创建成功后即使刷新失败也立即更新本地连接状态", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    let integrationLoads = 0;
    staffApiMock.mockImplementation((url: string, options?: { method?: string }) => {
      if (url.endsWith("/credentials") && options?.method === "POST") {
        return Promise.resolve({
          id: "credential-new",
          clientId: "client-new",
          clientSecret: "secret-new",
          secretPrefix: "secret",
          createdAt: "2026-08-03T08:00:00.000Z",
        });
      }
      integrationLoads += 1;
      return integrationLoads === 1
        ? Promise.resolve(integrationView("服务器名称"))
        : Promise.reject(new Error("刷新失败"));
    });

    render(
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <UniversalIntegrationPanel projectId="project-1" canEdit />
        </ToastProvider>
      </QueryClientProvider>,
    );

    fireEvent.click(await screen.findByRole("button", { name: "生成凭据" }));

    await waitFor(() =>
      expect(screen.getAllByText("client-new").length).toBeGreaterThan(0),
    );
    expect(screen.queryByText("尚未生成有效接入凭据。")).toBeNull();
  });

  it("Native Launch 开关随配置保存，最近会话标出 iframe / Native", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const base = integrationView("原生应用连接");
    staffApiMock.mockImplementation((url: string, options?: unknown) => {
      if (options === undefined || (options as { signal?: unknown }).signal) {
        return Promise.resolve({
          ...base,
          connection: {
            ...base.connection,
            recentSessions: [
              {
                id: "session-native",
                contactId: "contact-1",
                contactName: "桌面用户",
                externalUserId: "desktop-1",
                launchMode: "native",
                createdAt: "2026-09-28T02:00:00.000Z",
                lastSeenAt: "2026-09-28T02:00:00.000Z",
                expiresAt: "2026-09-28T04:00:00.000Z",
                revokedAt: null,
                status: "ACTIVE",
              },
              {
                id: "session-iframe",
                contactId: "contact-2",
                contactName: "网页用户",
                externalUserId: "web-1",
                launchMode: "iframe",
                createdAt: "2026-09-28T01:00:00.000Z",
                lastSeenAt: "2026-09-28T01:00:00.000Z",
                expiresAt: "2026-09-28T03:00:00.000Z",
                revokedAt: null,
                status: "EXPIRED",
              },
            ],
          },
        });
      }
      return Promise.resolve({ connection: base.connection, webhookSecret: null });
    });

    render(
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <UniversalIntegrationPanel projectId="project-1" canEdit />
        </ToastProvider>
      </QueryClientProvider>,
    );

    const nativeSwitch = await screen.findByRole("switch", {
      name: "允许原生应用启动（Native Launch）",
    });
    expect(
      screen.getByText(
        "用于桌面或移动 App：由 App 后端创建票据，App 在自己的窗口、系统浏览器或 WebView 中顶层打开，不做 iframe 来源校验。",
      ),
    ).toBeTruthy();
    expect(screen.getByText("Native")).toBeTruthy();
    expect(screen.getByText("iframe")).toBeTruthy();
    expect(screen.getByText("桌面用户 · desktop-1")).toBeTruthy();

    fireEvent.click(nativeSwitch);
    fireEvent.click(screen.getByRole("button", { name: "保存配置" }));
    await waitFor(() =>
      expect(vi.mocked(jsonRequest)).toHaveBeenCalledWith(
        "PUT",
        expect.objectContaining({ allowNativeLaunch: true }),
      ),
    );
  });
});
