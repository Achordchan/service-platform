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

  it("拒绝与模板不可用混合时，逐类说明并保留去设置入口", () => {
    expect(
      feedbackForSubscribeOutcome({
        decisions: [],
        acceptedCount: 0,
        recordedCount: 0,
        rejectedCount: 1,
        bannedCount: 2,
        filteredCount: 0,
        unknownCount: 0,
        identityChanged: false,
      }),
    ).toEqual({
      mode: "modal",
      title: "微信提醒未开启",
      content: "1 类未允许，可前往微信设置重新开启；2 类模板不可用，请联系平台管理员。",
      openSettings: true,
    });
  });

  it("模板不可用与未知结果混合时，不谎称可通过设置恢复", () => {
    expect(
      feedbackForSubscribeOutcome({
        decisions: [],
        acceptedCount: 0,
        recordedCount: 0,
        rejectedCount: 0,
        bannedCount: 1,
        filteredCount: 0,
        unknownCount: 1,
        identityChanged: false,
      }),
    ).toEqual({
      mode: "modal",
      title: "微信提醒暂不可用",
      content: "1 类模板不可用，请联系平台管理员；1 类未返回明确结果，请重试。",
      openSettings: false,
    });
  });

  it("全部模板不可用时沿用专属文案", () => {
    expect(
      feedbackForSubscribeOutcome({
        decisions: [],
        acceptedCount: 0,
        recordedCount: 0,
        rejectedCount: 0,
        bannedCount: 2,
        filteredCount: 1,
        unknownCount: 0,
        identityChanged: false,
      }),
    ).toEqual({
      mode: "modal",
      title: "微信提醒暂不可用",
      content: "当前订阅模板不可用，请联系平台管理员检查微信模板配置。",
    });
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
