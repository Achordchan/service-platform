import { describe, expect, it } from "vitest";
import {
  defaultNotificationDeliveryRuleState,
  findNotificationDeliveryRuleViolation,
  isNotificationEmailRuleEnabled,
  notificationTypesForEmailRule,
  dingTalkEventTypesForRule,
  resolveNotificationSoundEnabled,
  ruleKeyForProjectNotification,
  ruleKeyForRequestActivity,
  type NotificationDeliveryRuleUpdate,
} from "@/modules/notifications/notification-delivery-rules";

function rule(
  input: Partial<NotificationDeliveryRuleUpdate> &
    Pick<NotificationDeliveryRuleUpdate, "key">,
): NotificationDeliveryRuleUpdate {
  return {
    notificationEnabled: true,
    soundEnabled: true,
    emailEnabled: false,
    dingtalkEnabled: false,
    ...input,
  };
}

describe("后台通知规则", () => {
  it("将项目和服务请求活动映射到固定场景", () => {
    expect(ruleKeyForProjectNotification("PROJECT_CREATED")).toBe(
      "PROJECT_CREATED",
    );
    expect(ruleKeyForProjectNotification("PROJECT_STAGE")).toBe(
      "PROJECT_STAGE",
    );
    expect(ruleKeyForProjectNotification("UPDATE_COMMENT")).toBe(
      "PROJECT_UPDATE",
    );
    expect(
      ruleKeyForRequestActivity({
        notificationType: "REQUEST_MESSAGE",
        visibility: "CUSTOMER_VISIBLE",
      }),
    ).toBe("REQUEST_PUBLIC_MESSAGE");
    expect(
      ruleKeyForRequestActivity({
        notificationType: "REQUEST_MESSAGE",
        visibility: "INTERNAL",
      }),
    ).toBe("REQUEST_INTERNAL_NOTE");
    expect(
      ruleKeyForRequestActivity({ notificationType: "REQUEST_ARCHIVE" }),
    ).toBe("REQUEST_ARCHIVE");
    expect(
      ruleKeyForRequestActivity({ notificationType: "REQUEST_CLAIMED" }),
    ).toBe("REQUEST_CLAIMED");
    expect(notificationTypesForEmailRule("REQUEST_PUBLIC_MESSAGE")).toEqual([
      "REQUEST_MESSAGE",
    ]);
    expect(notificationTypesForEmailRule("PROJECT_UPDATE")).toEqual([
      "PROJECT_UPDATE",
      "UPDATE_COMMENT",
    ]);
    expect(notificationTypesForEmailRule("PROJECT_CREATED")).toEqual([
      "PROJECT_CREATED",
    ]);
    expect(notificationTypesForEmailRule("REQUEST_CLAIMED")).toEqual([
      "REQUEST_CLAIMED",
    ]);
    expect(dingTalkEventTypesForRule("REQUEST_CREATED")).toEqual([
      "REQUEST_CREATED",
    ]);
    expect(dingTalkEventTypesForRule("REQUEST_PUBLIC_MESSAGE")).toEqual([
      "REQUEST_CUSTOMER_REPLIED",
    ]);
  });

  it("拒绝重复场景和不支持的邮件渠道", () => {
    expect(
      findNotificationDeliveryRuleViolation([
        rule({ key: "PROJECT_UPDATE" }),
        rule({ key: "PROJECT_UPDATE" }),
      ]),
    ).toEqual(
      expect.objectContaining({ code: "DUPLICATE_NOTIFICATION_RULE" }),
    );
    expect(
      findNotificationDeliveryRuleViolation([
        rule({ key: "REQUEST_INTERNAL_NOTE", emailEnabled: true }),
      ]),
    ).toEqual(expect.objectContaining({ code: "EMAIL_NOT_SUPPORTED" }));
    expect(
      findNotificationDeliveryRuleViolation([
        rule({ key: "REQUEST_STATUS", dingtalkEnabled: true }),
      ]),
    ).toEqual(expect.objectContaining({ code: "DINGTALK_NOT_SUPPORTED" }));
    expect(
      findNotificationDeliveryRuleViolation([
        rule({ key: "REQUEST_CREATED", dingtalkEnabled: true }),
      ]),
    ).toBeNull();
  });

  it("项目交付邮件支持显式开启，但默认保持关闭", () => {
    expect(defaultNotificationDeliveryRuleState("PROJECT_CREATED")).toEqual({
      notificationEnabled: true,
      soundEnabled: true,
      emailEnabled: false,
      dingtalkEnabled: false,
      wechatEnabled: false,
    });
    expect(defaultNotificationDeliveryRuleState("PROJECT_UPDATE")).toEqual({
      notificationEnabled: true,
      soundEnabled: true,
      emailEnabled: false,
      dingtalkEnabled: false,
      wechatEnabled: false,
    });
    expect(
      findNotificationDeliveryRuleViolation([
        rule({ key: "PROJECT_UPDATE", emailEnabled: true }),
      ]),
    ).toBeNull();
    expect(defaultNotificationDeliveryRuleState("REQUEST_CREATED").emailEnabled)
      .toBe(true);
    expect(defaultNotificationDeliveryRuleState("REQUEST_CLAIMED")).toEqual({
      notificationEnabled: true,
      soundEnabled: true,
      emailEnabled: true,
      dingtalkEnabled: false,
      wechatEnabled: false,
    });
  });

  it("邮件必须依赖未读通知，提示音规则不能被活动强制绕过", () => {
    expect(
      findNotificationDeliveryRuleViolation([
        rule({
          key: "REQUEST_PUBLIC_MESSAGE",
          notificationEnabled: false,
          emailEnabled: true,
        }),
      ]),
    ).toEqual(expect.objectContaining({ code: "EMAIL_REQUIRES_NOTIFICATION" }));
    expect(resolveNotificationSoundEnabled(false, true)).toBe(false);
    expect(resolveNotificationSoundEnabled(true, false)).toBe(false);
    expect(resolveNotificationSoundEnabled(true)).toBe(true);
    expect(
      isNotificationEmailRuleEnabled(
        "REQUEST_MESSAGE",
        new Map([
          [
            "REQUEST_PUBLIC_MESSAGE",
            {
              notificationEnabled: true,
              soundEnabled: true,
              emailEnabled: false,
              dingtalkEnabled: false,
              wechatEnabled: false,
            },
          ],
        ]),
      ),
    ).toBe(false);
    expect(
      isNotificationEmailRuleEnabled(
        "PROJECT_UPDATE",
        new Map([
          [
            "PROJECT_UPDATE",
            {
              notificationEnabled: true,
              soundEnabled: true,
              emailEnabled: true,
              dingtalkEnabled: false,
              wechatEnabled: false,
            },
          ],
        ]),
      ),
    ).toBe(true);
  });
});
