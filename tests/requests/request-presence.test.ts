import { describe, expect, it } from "vitest";
import { requestPresenceSchema } from "@/modules/requests/request-schemas";

describe("请求在线与输入状态参数", () => {
  it("兼容心跳和离开请求", () => {
    expect(
      requestPresenceSchema.parse({
        sessionId: "session-12345678",
        action: "heartbeat",
      }),
    ).toMatchObject({ action: "heartbeat" });
    expect(
      requestPresenceSchema.parse({
        sessionId: "session-12345678",
        action: "leave",
      }),
    ).toMatchObject({ action: "leave" });
  });

  it("输入状态必须明确开始或结束", () => {
    expect(() =>
      requestPresenceSchema.parse({
        sessionId: "session-12345678",
        action: "typing",
      }),
    ).toThrow();
    expect(
      requestPresenceSchema.parse({
        sessionId: "session-12345678",
        action: "typing",
        typing: true,
        visibility: "CUSTOMER_VISIBLE",
      }),
    ).toMatchObject({
      action: "typing",
      typing: true,
      visibility: "CUSTOMER_VISIBLE",
    });
  });
});
