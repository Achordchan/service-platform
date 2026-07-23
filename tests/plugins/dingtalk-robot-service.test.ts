import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@achord/plugin-dingtalk-robot/runtime", () => ({
  sendDingTalkTicketNotification: vi.fn(),
}));
vi.mock("@achord/plugin-dingtalk-robot/config", () => ({
  parseDingTalkRobotBinding: vi.fn(),
}));
vi.mock("@/lib/runtime-env", () => ({
  env: { APP_URL: "https://support.example.com" },
}));
vi.mock("@/lib/system-db", () => ({ withSystemDb: vi.fn() }));
vi.mock("@/modules/plugins/plugin-secret-config", () => ({
  decryptPluginSecretConfig: vi.fn(),
  fingerprintPluginConfiguration: vi.fn(),
}));
vi.mock("@/modules/plugins/plugin-registry", () => ({
  DINGTALK_ROBOT_PLUGIN_KEY: "dingtalk-robot",
  tryParseRegisteredPluginConfig: vi.fn(),
}));

import { recordDingTalkRobotDelivery } from "@/modules/plugins/dingtalk-robot-service";

describe("钉钉 Outbox 入队", () => {
  it("数据库函数返回 ERROR 时输出不含密钥的结构化错误", async () => {
    const queryRaw = vi.fn().mockResolvedValue([
      { deliveryId: null, outcome: "ERROR", errorCode: "23514" },
    ]);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await recordDingTalkRobotDelivery(
      { $queryRaw: queryRaw } as never,
      {
        eventKey: "request-created:request-1",
        eventType: "REQUEST_CREATED",
        requestId: "request-1",
        actorName: "测试客户",
      },
    );

    expect(result).toBeNull();
    expect(error).toHaveBeenCalledWith(
      "ACHORD_DINGTALK_OUTBOX_ENQUEUE_FAILED",
      expect.stringContaining('"errorCode":"23514"'),
    );
    expect(error.mock.calls.flat().join(" ")).not.toContain("access_token");
    error.mockRestore();
  });
});
