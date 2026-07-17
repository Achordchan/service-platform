import { describe, expect, it } from "vitest";
import {
  hasPluginSettings,
  supportsPluginAction,
  type PluginView,
} from "@/components/staff/plugin-center";

function pluginView(overrides: Partial<PluginView>): PluginView {
  return {
    key: "test-plugin",
    name: "测试插件",
    description: "测试",
    version: "1.0.0",
    category: "测试",
    minimumPlatformVersion: "0.1.0",
    capabilities: [],
    enabled: false,
    config: {},
    healthStatus: "READY",
    lastCheckedAt: null,
    lastError: null,
    updatedAt: new Date(0).toISOString(),
    settings: [],
    runs: [],
    ...overrides,
  };
}

describe("插件中心能力隔离", () => {
  it("Sub2API 插件不显示 WebP 设置或历史迁移", () => {
    const sub2api = pluginView({ key: "sub2api-connector" });
    expect(hasPluginSettings(sub2api)).toBe(false);
    expect(supportsPluginAction(sub2api, "migrate-history")).toBe(false);
  });

  it("仅为声明能力的插件显示设置和历史迁移", () => {
    const webp = pluginView({
      key: "image-webp",
      settings: [
        {
          key: "quality",
          type: "number",
          label: "WebP 质量",
          description: "图片质量",
          min: 60,
          max: 95,
        },
      ],
      actions: [
        {
          key: "migrate-history",
          label: "迁移历史图片",
          description: "处理历史图片",
        },
      ],
    });
    expect(hasPluginSettings(webp)).toBe(true);
    expect(supportsPluginAction(webp, "migrate-history")).toBe(true);
  });
});
