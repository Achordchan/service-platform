import { describe, expect, it } from "vitest";
import { resolveSettingsTab } from "@/components/staff/settings-workspace";

describe("设置工作区标签解析", () => {
  it("保留旧服务配置入口指定的服务标签", () => {
    expect(resolveSettingsTab("services", false)).toBe("services");
  });

  it("插件停用时不允许进入钉钉模板标签", () => {
    expect(resolveSettingsTab("dingtalk", false)).toBe("platform");
    expect(resolveSettingsTab("dingtalk", true)).toBe("dingtalk");
  });

  it("未知标签回到平台设置", () => {
    expect(resolveSettingsTab("unknown", true)).toBe("platform");
    expect(resolveSettingsTab(null, true)).toBe("platform");
  });
});
