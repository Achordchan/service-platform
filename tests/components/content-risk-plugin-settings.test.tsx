// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ContentRiskPluginSettings } from "@/components/staff/content-risk-plugin-settings";
import { ToastProvider } from "@/components/shared/toast-provider";

const staffApiMock = vi.hoisted(() => vi.fn());

vi.mock("@/components/staff/staff-api", () => ({
  jsonRequest: vi.fn(),
  staffApi: staffApiMock,
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("内容审核工作区", () => {
  it("只展示风控状态和历史入口，不展示插件配置字段", async () => {
    staffApiMock.mockResolvedValue({
      runtime: {
        enabledAt: "2026-07-29T08:00:00.000Z",
        bypassedAt: null,
        capabilityReport: null,
      },
      counts: {},
      stats: { averageDurationMs: null, sampledCompletedCount: 0 },
      reviews: [],
    });

    render(
      <ToastProvider>
        <ContentRiskPluginSettings
          enabled
          healthStatus="READY"
          config={{
            baseUrl: "https://model.example.com",
            model: "gpt-5.4-mini",
            fullAuditEnabled: true,
          }}
          readOnly
        />
      </ToastProvider>,
    );

    await waitFor(() => expect(staffApiMock).toHaveBeenCalledTimes(1));
    expect(screen.getByText("风控正在运行")).toBeTruthy();
    expect(screen.getByRole("button", { name: "查看历史风控" })).toBeTruthy();
    expect(screen.queryByLabelText("模型 Base URL")).toBeNull();
    expect(screen.queryByLabelText("API Key")).toBeNull();
    expect(screen.queryByRole("button", { name: "保存配置" })).toBeNull();
  });
});
