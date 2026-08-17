// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ContentRiskPluginSettings } from "@/components/staff/content-risk-plugin-settings";
import { ToastProvider } from "@/components/shared/toast-provider";

vi.mock("@/components/staff/staff-api", () => ({
  jsonRequest: vi.fn(),
  staffApi: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ContentRiskPluginSettings", () => {
  it("展示配置字段和保存按钮", () => {
    render(
      <QueryClientProvider
        client={
          new QueryClient({
            defaultOptions: { queries: { retry: false } },
          })
        }
      >
        <ToastProvider>
          <ContentRiskPluginSettings
            config={{
              baseUrl: "https://model.example.com",
              model: "gpt-5.4-mini",
              fullAuditEnabled: true,
            }}
            secrets={{ apiKey: "" }}
            hasApiKey
            onConfigChange={vi.fn()}
            onSecretChange={vi.fn()}
            onSave={vi.fn()}
          />
        </ToastProvider>
      </QueryClientProvider>,
    );

    expect(screen.getByLabelText("模型 Base URL")).toBeTruthy();
    expect(screen.getByLabelText("API Key")).toBeTruthy();
    expect(screen.getByRole("button", { name: "保存配置" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "获取模型" })).toBeTruthy();
  });
});
