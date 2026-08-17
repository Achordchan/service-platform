import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Actor } from "@/lib/actor";
import { NOTIFICATION_DELIVERY_RULES } from "@/modules/notifications/notification-delivery-rules";

const mocks = vi.hoisted(() => ({
  userFindUniqueOrThrow: vi.fn(),
  preferenceFindMany: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/actor", () => ({
  withActorDb: (_actor: Actor, callback: (tx: unknown) => unknown) =>
    callback({
      user: { findUniqueOrThrow: mocks.userFindUniqueOrThrow },
      userNotificationPreference: { findMany: mocks.preferenceFindMany },
    }),
}));

import { getNotificationPreferences } from "@/modules/users/notification-preference-service";

const actor: Actor = {
  id: "user-1",
  name: "测试用户",
  email: "user@example.test",
  platformRole: "CUSTOMER",
  isPlatformAdmin: false,
  isStaff: false,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("分类通知偏好", () => {
  it("顺序读取同一事务中的用户和分类偏好", async () => {
    let userQueryCompleted = false;
    mocks.userFindUniqueOrThrow.mockImplementation(async () => {
      await Promise.resolve();
      userQueryCompleted = true;
      return {
        soundNotificationsEnabled: true,
        requestEmailNotificationsEnabled: true,
      };
    });
    mocks.preferenceFindMany.mockImplementation(() => {
      expect(userQueryCompleted).toBe(true);
      return Promise.resolve([
        { ruleKey: "REQUEST_PUBLIC_MESSAGE", emailEnabled: false },
      ]);
    });

    const result = await getNotificationPreferences(actor);

    expect(result.perType).toContainEqual({
      ruleKey: "REQUEST_PUBLIC_MESSAGE",
      emailEnabled: false,
    });
    // 客户视角：隐藏仅面向员工的规则（接手通知、内容风控告警）
    expect(result.perType.map((item) => item.ruleKey)).toEqual(
      NOTIFICATION_DELIVERY_RULES.filter(
        (rule) => rule.emailSupported && !("customerHidden" in rule),
      ).map((rule) => rule.key),
    );
    expect(result.perType.map((item) => item.ruleKey)).not.toContain(
      "CONTENT_RISK_ALERT",
    );
  });

  it("员工视角返回全量可配置规则", async () => {
    const staffActor: Actor = { ...actor, isStaff: true };
    const result = await getNotificationPreferences(staffActor);
    expect(result.perType.map((item) => item.ruleKey)).toEqual(
      NOTIFICATION_DELIVERY_RULES.filter((rule) => rule.emailSupported).map(
        (rule) => rule.key,
      ),
    );
  });
});
