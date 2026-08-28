import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import {
  hasDeliveryOverride,
  isDeliveryOverrideEffective,
  isEmailForced,
  notificationDeliveryOverrideSchema,
  resolveDeliveryChannel,
} from "@/modules/notifications/notification-delivery-override";
import {
  deliveryNoticeChannels,
  deliveryNoticeText,
  deliveryOverridePayload,
  isDeliveryOverrideActive,
  materializeDeliveryOverride,
  RULE_KEY_BY_SCENE,
  type DeliveryChannelRule,
} from "@/lib/delivery-notice";

const rule: DeliveryChannelRule = {
  key: "REQUEST_PUBLIC_MESSAGE",
  label: "公开回复",
  notificationEnabled: true,
  emailEnabled: true,
  wechatEnabled: false,
  emailSupported: true,
  wechatSupported: true,
};

describe("单次投递覆盖", () => {
  it("未给值时按规则走，给了值才覆盖", () => {
    expect(resolveDeliveryChannel(true, undefined)).toBe(true);
    expect(resolveDeliveryChannel(false, undefined)).toBe(false);
    expect(resolveDeliveryChannel(false, true)).toBe(true);
    expect(resolveDeliveryChannel(true, false)).toBe(false);
  });

  it("只有邮件被显式打开才允许无视收件人偏好", () => {
    expect(isEmailForced({ email: true })).toBe(true);
    expect(isEmailForced({ email: false })).toBe(false);
    expect(isEmailForced({})).toBe(false);
    expect(isEmailForced(undefined)).toBe(false);
  });

  it("空对象不算覆盖，空排除名单也不算", () => {
    expect(hasDeliveryOverride({})).toBe(false);
    expect(hasDeliveryOverride(undefined)).toBe(false);
    expect(hasDeliveryOverride({ excludeUserIds: [] })).toBe(false);
    expect(hasDeliveryOverride({ notification: false })).toBe(true);
    expect(hasDeliveryOverride({ excludeUserIds: ["u1"] })).toBe(true);
  });

  it("逐人排除只过滤通知，并记下真的被排掉的人", async () => {
    const { applyDeliveryExclusions } = await import(
      "@/modules/notifications/notification-delivery-override"
    );
    const notifications = [
      { userId: "a" },
      { userId: "b" },
      { userId: "c" },
    ];
    expect(applyDeliveryExclusions(notifications, {})).toEqual({
      notifications,
      excludedUserIds: [],
    });
    // 名单里有本来就不在收件人里的人，不该记进审计
    expect(
      applyDeliveryExclusions(notifications, {
        excludeUserIds: ["b", "zzz"],
      }),
    ).toEqual({
      notifications: [{ userId: "a" }, { userId: "c" }],
      excludedUserIds: ["b"],
    });
  });

  it("审计只在真的改变了结果时触发", () => {
    const none = {
      forcedChannels: [] as never[],
      suppressedChannels: [] as never[],
      emailPreferenceOverriddenUserIds: [] as string[],
      excludedUserIds: [] as string[],
    };
    // 点开自定义但什么都没改 → 不记
    expect(isDeliveryOverrideEffective(none)).toBe(false);
    expect(
      isDeliveryOverrideEffective({
        ...none,
        emailPreferenceOverriddenUserIds: ["user-1"],
      }),
    ).toBe(true);
    expect(
      isDeliveryOverrideEffective({ ...none, forcedChannels: ["wechat"] }),
    ).toBe(true);
    expect(
      isDeliveryOverrideEffective({ ...none, excludedUserIds: ["user-2"] }),
    ).toBe(true);
  });

  it("schema 拒绝非布尔值", () => {
    expect(() =>
      notificationDeliveryOverrideSchema.parse({ email: "yes" }),
    ).toThrow();
    expect(notificationDeliveryOverrideSchema.parse({})).toEqual({});
  });
});

describe("发送前提示行", () => {
  it("站内是载体：关掉它，邮件与微信一并不显示", () => {
    expect(deliveryNoticeChannels(rule, {})).toEqual([
      "notification",
      "email",
    ]);
    expect(deliveryNoticeChannels(rule, { notification: false })).toEqual([]);
    expect(deliveryNoticeText([])).toBe("本次操作不会发出提醒");
  });

  it("覆盖会反映到提示文案里", () => {
    expect(deliveryNoticeChannels(rule, { wechat: true })).toEqual([
      "notification",
      "email",
      "wechat",
    ]);
    expect(
      deliveryNoticeText(deliveryNoticeChannels(rule, { email: false })),
    ).toBe("即将通过 站内通知 提醒相关人员");
  });

  it("规则不支持的通道即使被勾也不显示", () => {
    const noEmail: DeliveryChannelRule = { ...rule, emailSupported: false };
    expect(deliveryNoticeChannels(noEmail, { email: true })).toEqual([
      "notification",
    ]);
  });

  it("没显式设过任何值才算「未自定义」，不往请求体里塞字段", () => {
    expect(isDeliveryOverrideActive({}, rule)).toBe(false);
    expect(deliveryOverridePayload({}, rule)).toEqual({});
    expect(isDeliveryOverrideActive({ email: false }, rule)).toBe(true);
    expect(deliveryOverridePayload({ email: false }, rule)).toEqual({
      deliveryOverride: { email: false },
    });
  });

  it("显式开着的邮件即使与后台规则相同也要提交 —— 它才是强制发送的凭据", () => {
    // rule.emailEnabled 已经是 true，收件人却自己退订了。弹窗逐人标的是「强制发送」、
    // 警告条写的是「保持开启将强制发送」。若按「与规则相同就不算覆盖」丢掉 email:true，
    // 后端 isEmailForced 恒为 false，实际仍会尊重退订 —— UI 承诺与真实行为对不上。
    expect(rule.emailEnabled).toBe(true);
    expect(isDeliveryOverrideActive({ email: true }, rule)).toBe(true);
    expect(deliveryOverridePayload({ email: true }, rule)).toEqual({
      deliveryOverride: { email: true },
    });
    expect(isEmailForced({ email: true })).toBe(true);
  });

  it("应用弹窗时把选择固化成显式值：默认没动的通道也要落成显式布尔", () => {
    // 用户点「应用」就是显式选择：邮件停在默认的「开」上也要提交 email:true，
    // 否则对已退订的收件人只是看起来会强制发送
    expect(materializeDeliveryOverride({}, rule)).toEqual({
      notification: true,
      email: true,
      wechat: false,
    });
    expect(
      deliveryOverridePayload(materializeDeliveryOverride({}, rule), rule),
    ).toEqual({
      deliveryOverride: { notification: true, email: true, wechat: false },
    });
  });

  it("固化时保留排除名单，且不写本场景不支持的通道", () => {
    const noEmail: DeliveryChannelRule = {
      ...rule,
      emailSupported: false,
      wechatSupported: false,
    };
    expect(
      materializeDeliveryOverride({ excludeUserIds: ["u1"] }, noEmail),
    ).toEqual({ notification: true, excludeUserIds: ["u1"] });
  });

  it("固化不会覆盖用户已经改过的值", () => {
    expect(materializeDeliveryOverride({ email: false }, rule)).toEqual({
      notification: true,
      email: false,
      wechat: false,
    });
  });

  it("每个场景都有对应的规则 key", () => {
    expect(Object.values(RULE_KEY_BY_SCENE)).toEqual([
      "PROJECT_UPDATE",
      "PROJECT_MILESTONE",
      "PROJECT_STAFF",
      "REQUEST_PUBLIC_MESSAGE",
      "REQUEST_STATUS",
    ]);
  });
});

describe("覆盖的越权防线", () => {
  it("场景不支持的通道，覆盖会被丢掉", async () => {
    const { sanitizeDeliveryOverride } = await import(
      "@/modules/notifications/notification-delivery-override"
    );
    const staff = { isStaff: true };
    // 内部备注这类场景不支持邮件：伪造请求想强开也不行
    expect(
      sanitizeDeliveryOverride(
        staff,
        { email: true, wechat: true },
        { emailSupported: false, wechatSupported: false },
      ),
    ).toBeUndefined();
    expect(
      sanitizeDeliveryOverride(
        staff,
        { notification: false, email: true },
        { emailSupported: false, wechatSupported: false },
      ),
    ).toEqual({ notification: false });
    expect(
      sanitizeDeliveryOverride(
        staff,
        { email: true },
        { emailSupported: true, wechatSupported: false },
      ),
    ).toEqual({ notification: undefined, email: true });
  });

  it("客户提交的覆盖一律丢掉 —— 这是员工写操作专用的能力", async () => {
    const { sanitizeDeliveryOverride } = await import(
      "@/modules/notifications/notification-delivery-override"
    );
    const support = { emailSupported: true, wechatSupported: true };
    const customer = { isStaff: false };
    // 客户也打工单回复 / 状态接口：不挡的话，能把自己的回复对员工静音……
    expect(
      sanitizeDeliveryOverride(customer, { notification: false }, support),
    ).toBeUndefined();
    // ……或强制给已退订的员工发邮件
    expect(
      sanitizeDeliveryOverride(customer, { email: true }, support),
    ).toBeUndefined();
    expect(
      sanitizeDeliveryOverride(
        customer,
        { excludeUserIds: ["staff-1"] },
        support,
      ),
    ).toBeUndefined();
  });
});

describe("强制发送的边界：只盖个人偏好，不改收件人范围", () => {
  it("场景不发邮件给某人时，他不会被标成 emailEligible —— 强制也到不了他", async () => {
    const { planProjectActivity } = await import(
      "@/modules/notifications/activity-delivery"
    );
    // 「进度动态与评论」这类项目场景的邮件只发客户，内部人员不在收件范围里
    const delivery = planProjectActivity({
      actorId: "actor-1",
      audience: {
        customerUserIds: ["customer-1"],
        projectStaffUserIds: ["staff-1"],
        projectManagerUserIds: ["staff-1"],
        platformAdminUserIds: ["admin-1"],
      },
      visibility: "CUSTOMER_VISIBLE",
      eventType: "PROJECT_UPDATE_CREATED",
      eventPayload: {},
      notificationType: "PROJECT_UPDATE",
      notificationTitle: "t",
      notificationBody: "b",
      customerSpaceId: "space-1",
      projectId: "project-1",
      emailRecipientUserIds: ["customer-1"],
    });
    const byUser = new Map(
      delivery.notifications.map((item) => [item.userId, item]),
    );
    // 客户在收件范围里 → 强制邮件对他有效
    expect(byUser.get("customer-1")?.emailEligible).toBe(true);
    // 内部人员会收到站内通知，但不是邮件收件人 → 强制邮件对他无效
    expect(byUser.get("staff-1")?.emailEligible).toBe(false);
    expect(byUser.get("admin-1")?.emailEligible).toBe(false);
  });

  it("内部人员在收件范围里时（如工单公开回复由客户发起），强制对他同样有效", async () => {
    const { planRequestActivity } = await import(
      "@/modules/notifications/activity-delivery"
    );
    const delivery = planRequestActivity({
      actorId: "customer-1",
      audience: {
        customerUserIds: ["customer-1"],
        projectStaffUserIds: ["staff-1"],
        projectManagerUserIds: ["staff-1"],
        platformAdminUserIds: ["admin-1"],
      },
      includeCustomers: false,
      notifyProjectManagers: true,
      notifyPlatformAdmins: true,
      relevantWorkerUserIds: ["staff-1"],
      eventType: "REQUEST_MESSAGE_CREATED",
      eventPayload: { visibility: "CUSTOMER_VISIBLE" },
      notificationType: "REQUEST_MESSAGE",
      notificationTitle: "t",
      notificationBody: "b",
      customerSpaceId: "space-1",
      projectId: "project-1",
      serviceRequestId: "request-1",
      emailRecipientUserIds: ["staff-1", "admin-1"],
    });
    const byUser = new Map(
      delivery.notifications.map((item) => [item.userId, item]),
    );
    expect(byUser.get("staff-1")?.emailEligible).toBe(true);
    expect(byUser.get("admin-1")?.emailEligible).toBe(true);
  });
});
