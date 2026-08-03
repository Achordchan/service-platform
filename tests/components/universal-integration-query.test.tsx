// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UniversalIntegrationPanel } from "@/components/staff/universal-integration-panel";
import { ToastProvider } from "@/components/shared/toast-provider";
import { queryKeys } from "@/lib/query-keys";

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
});
