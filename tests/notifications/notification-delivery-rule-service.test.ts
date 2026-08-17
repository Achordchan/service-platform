import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Actor } from "@/lib/actor";

const mocks = vi.hoisted(() => ({
  upsert: vi.fn(),
  findMany: vi.fn(),
  notificationUpdateMany: vi.fn(),
  mailUpdateMany: vi.fn(),
  dingTalkUpdateMany: vi.fn(),
  pluginFindUnique: vi.fn(),
  runtimeFindUnique: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("@/lib/actor", () => ({
  withActorDb: (_actor: Actor, callback: (tx: unknown) => unknown) =>
    callback({
      notificationDeliveryRule: {
        upsert: mocks.upsert,
        findMany: mocks.findMany,
      },
      notification: { updateMany: mocks.notificationUpdateMany },
      mailMessage: { updateMany: mocks.mailUpdateMany },
      dingTalkRobotDelivery: { updateMany: mocks.dingTalkUpdateMany },
      pluginInstallation: { findUnique: mocks.pluginFindUnique },
      contentRiskRuntimeState: { findUnique: mocks.runtimeFindUnique },
    }),
}));

vi.mock("@/modules/audit/audit-service", () => ({
  writeAuditLog: vi.fn(),
}));

vi.mock("@/modules/plugins/plugin-installation-service", () => ({
  ensurePluginInstallations: vi.fn(),
}));

import { updateNotificationDeliveryRules } from "@/modules/notifications/notification-delivery-rule-service";

const admin: Actor = {
  id: "admin-1",
  name: "管理员",
  email: "admin@example.test",
  platformRole: "PLATFORM_ADMIN",
  isPlatformAdmin: true,
  isStaff: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findMany.mockResolvedValue([
    {
      key: "CONTENT_RISK_ALERT",
      notificationEnabled: true,
      soundEnabled: true,
      emailEnabled: false,
      dingtalkEnabled: false,
      wechatEnabled: false,
    },
  ]);
  mocks.pluginFindUnique.mockResolvedValue({
    enabled: false,
    healthStatus: "UNKNOWN",
  });
  mocks.runtimeFindUnique.mockResolvedValue(null);
});

describe("通知规则状态驱动返回", () => {
  it("插件停用时保存规则不会回显风控项，并取消排队的风控邮件", async () => {
    const result = await updateNotificationDeliveryRules(admin, {
      rules: [
        {
          key: "CONTENT_RISK_ALERT",
          notificationEnabled: true,
          soundEnabled: true,
          emailEnabled: false,
          dingtalkEnabled: false,
          wechatEnabled: false,
        },
      ],
    });

    expect(result.some((rule) => rule.key === "CONTENT_RISK_ALERT")).toBe(
      false,
    );
    expect(mocks.mailUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          sourceType: {
            in: [
              "STANDARD_REQUEST_NOTIFICATION",
              "STANDARD_PROJECT_NOTIFICATION",
              "CONTENT_RISK_NOTIFICATION",
            ],
          },
        }),
      }),
    );
  });
});
