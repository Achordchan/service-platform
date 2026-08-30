import { describe, expect, it } from "vitest";
import {
  feedbackForSubscribeFailure,
  feedbackForSubscribeOutcome,
  isSubscribeTemplateEnabled,
  permissionFromSetting,
  subscribeTemplateStatusText,
  summarizeSubscribeDecisions,
} from "../../miniapp/src/lib/subscribe-permission";

const TEMPLATES = [
  { templateKey: "REQUEST_REPLY", templateId: "template-reply" },
  { templateKey: "REQUEST_STATUS", templateId: "template-status" },
  { templateKey: "PROJECT_UPDATE", templateId: "template-project" },
] as const;

describe("微信订阅授权状态", () => {
  it("没有长期设置但仍有一次性额度时，按真实可发送状态显示已开启", () => {
    const permission = permissionFromSetting(true, undefined);
    expect(permission).toBe("unknown");
    expect(isSubscribeTemplateEnabled(permission, 1)).toBe(true);
    expect(subscribeTemplateStatusText(permission, 1)).toBe("可接收 1 条");
  });

  it("明确拒绝、封禁或关闭总开关时，旧额度不能冒充可发送", () => {
    expect(
      isSubscribeTemplateEnabled(permissionFromSetting(true, "reject"), 3),
    ).toBe(false);
    expect(
      isSubscribeTemplateEnabled(permissionFromSetting(true, "ban"), 3),
    ).toBe(false);
    expect(
      isSubscribeTemplateEnabled(permissionFromSetting(false, "accept"), 3),
    ).toBe(false);
    expect(subscribeTemplateStatusText("main-switch-off", 3)).toBe(
      "总开关已关闭",
    );
  });

  it("逐模板保留 accept、reject、filter，不再压成一个计数", () => {
    const summary = summarizeSubscribeDecisions(TEMPLATES, {
      "template-reply": "accept",
      "template-status": "reject",
      "template-project": "filter",
      errMsg: "requestSubscribeMessage:ok",
    });
    expect(summary).toEqual({
      decisions: [
        { templateKey: "REQUEST_REPLY", decision: "accept" },
        { templateKey: "REQUEST_STATUS", decision: "reject" },
        { templateKey: "PROJECT_UPDATE", decision: "filter" },
      ],
      acceptedCount: 1,
      rejectedCount: 1,
      bannedCount: 0,
      filteredCount: 1,
      unknownCount: 0,
    });
  });
});

describe("微信订阅授权反馈", () => {
  it("全部拒绝时给出可进入微信设置的明确反馈", () => {
    expect(
      feedbackForSubscribeOutcome({
        decisions: [],
        acceptedCount: 0,
        recordedCount: 0,
        rejectedCount: 3,
        bannedCount: 0,
        filteredCount: 0,
        unknownCount: 0,
        identityChanged: false,
      }),
    ).toEqual(
      expect.objectContaining({
        mode: "modal",
        title: "微信提醒未开启",
        openSettings: true,
      }),
    );
  });

  it("微信已允许但服务端同步失败时，不再误报未开启", () => {
    expect(
      feedbackForSubscribeOutcome({
        decisions: [],
        acceptedCount: 3,
        recordedCount: 0,
        rejectedCount: 0,
        bannedCount: 0,
        filteredCount: 0,
        unknownCount: 0,
        identityChanged: false,
      }),
    ).toEqual(
      expect.objectContaining({
        mode: "modal",
        title: "微信授权已完成",
      }),
    );
  });

  it("总开关关闭错误会引导用户进入微信设置", () => {
    expect(
      feedbackForSubscribeFailure({
        errMsg: "requestSubscribeMessage:fail 20004",
      }),
    ).toEqual(
      expect.objectContaining({
        title: "微信提醒总开关已关闭",
        openSettings: true,
      }),
    );
  });
});
