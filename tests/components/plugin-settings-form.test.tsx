// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PluginSettingsForm } from "@/components/staff/plugin-settings-form";
import type { PluginView } from "@/components/staff/plugin-center";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const plugin = {
  key: "example-plugin",
  name: "示例插件",
  description: "测试插件",
  version: "1.0.0",
  category: "UTILITY",
  minimumPlatformVersion: "1.0.0",
  capabilities: [],
  enabled: false,
  config: {},
  configuredSecretKeys: [],
  secretConfigState: "MISSING",
  healthStatus: "UNKNOWN",
  lastCheckedAt: null,
  lastError: null,
  updatedAt: "2026-08-01T00:00:00.000Z",
  settings: [
    {
      key: "timeout",
      type: "number" as const,
      label: "超时时间",
      description: "请求超时时间",
      min: 1,
      max: 60,
      required: true,
    },
    {
      key: "enabledFeature",
      type: "boolean" as const,
      label: "启用增强能力",
      description: "是否启用增强能力",
    },
    {
      key: "endpoint",
      type: "url" as const,
      label: "服务地址",
      description: "插件服务地址",
      required: true,
    },
    {
      key: "token",
      type: "secret-text" as const,
      label: "访问密钥",
      description: "插件访问密钥",
      required: true,
    },
  ],
  runs: [],
} satisfies PluginView;

describe("通用插件设置表单", () => {
  it("校验必填密钥、数字范围和 URL，并提交分离后的配置", async () => {
    const onSave = vi.fn().mockResolvedValue(true);

    render(
      <PluginSettingsForm
        plugin={plugin}
        initialConfig={{ timeout: 10, enabledFeature: false, endpoint: "" }}
        initialSecrets={{}}
        busy={false}
        onSave={onSave}
      />,
    );

    fireEvent.change(screen.getByRole("spinbutton", { name: /超时时间/ }), {
      target: { value: "61" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: /服务地址/ }), {
      target: { value: "not-a-url" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存配置" }));

    expect(await screen.findByText("超时时间不能大于 60")).toBeTruthy();
    expect(screen.getByText("服务地址必须是有效 URL")).toBeTruthy();
    expect(screen.getByText("请填写访问密钥")).toBeTruthy();
    expect(onSave).not.toHaveBeenCalled();

    fireEvent.change(screen.getByRole("spinbutton", { name: /超时时间/ }), {
      target: { value: "30" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: /服务地址/ }), {
      target: { value: "https://plugin.example.test/api" },
    });
    fireEvent.change(screen.getByLabelText(/访问密钥/), {
      target: { value: "secret-value" },
    });
    fireEvent.click(screen.getByRole("switch", { name: "启用增强能力" }));
    fireEvent.click(screen.getByRole("button", { name: "保存配置" }));

    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    expect(onSave).toHaveBeenCalledWith(
      {
        timeout: 30,
        enabledFeature: true,
        endpoint: "https://plugin.example.test/api",
      },
      { token: "secret-value" },
    );
    await waitFor(() =>
      expect((screen.getByLabelText(/访问密钥/) as HTMLInputElement).value).toBe(
        "",
      ),
    );
  });
});
