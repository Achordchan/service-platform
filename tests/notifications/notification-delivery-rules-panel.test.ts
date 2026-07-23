import { describe, expect, it } from "vitest";
import { notificationRuleChannels } from "@/components/staff/notification-delivery-rules-panel";

describe("通知规则通道条件渲染", () => {
  it("钉钉插件未启用时完全隐藏钉钉通道", () => {
    expect(notificationRuleChannels(true, false).map(([channel]) => channel)).toEqual([
      "notificationEnabled",
      "soundEnabled",
      "emailEnabled",
    ]);
  });

  it("钉钉插件启用后才显示钉钉通道", () => {
    expect(notificationRuleChannels(true, true).map(([channel]) => channel)).toEqual([
      "notificationEnabled",
      "soundEnabled",
      "emailEnabled",
      "dingtalkEnabled",
    ]);
  });

  it("邮件通道未启用时隐藏邮件规则但保留其他通道", () => {
    expect(notificationRuleChannels(false, true).map(([channel]) => channel)).toEqual([
      "notificationEnabled",
      "soundEnabled",
      "dingtalkEnabled",
    ]);
  });
});
