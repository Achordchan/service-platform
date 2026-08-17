import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Actor } from "@/lib/actor";

const mocks = vi.hoisted(() => ({
  authorizationHeader: null as string | null,
  resolveActor: vi.fn(),
  getCurrentSession: vi.fn(),
  resolveMiniappSession: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  headers: async () => ({
    get: (name: string) =>
      name.toLowerCase() === "authorization" ? mocks.authorizationHeader : null,
  }),
}));
vi.mock("@/lib/actor", () => ({ resolveActor: mocks.resolveActor }));
vi.mock("@/lib/session", () => ({
  getCurrentSession: mocks.getCurrentSession,
}));
vi.mock("@/modules/miniapp/session", () => ({
  resolveMiniappSessionFromAuthorization: mocks.resolveMiniappSession,
}));

const customerActor: Actor = {
  id: "user-customer",
  name: "客户甲",
  email: "customer@example.com",
  platformRole: "CUSTOMER",
  isPlatformAdmin: false,
  isStaff: false,
};

const webActor: Actor = { ...customerActor, id: "user-web" };

describe("统一 API Actor 解析：Bearer 与 Cookie 优先级", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authorizationHeader = null;
  });

  it("携带 Authorization 且 Bearer 有效时使用小程序会话 Actor", async () => {
    mocks.authorizationHeader = "Bearer ma_valid_token";
    mocks.resolveMiniappSession.mockResolvedValue({
      actor: customerActor,
      sessionId: "session-1",
      userId: customerActor.id,
    });
    const { resolveApiActor } = await import("@/modules/http/api-actor");

    const result = await resolveApiActor();

    expect(result).toEqual({ actor: customerActor });
    expect(mocks.resolveMiniappSession).toHaveBeenCalledExactlyOnceWith(
      "Bearer ma_valid_token",
    );
    // 关键：Bearer 模式下绝不读取 Cookie 会话
    expect(mocks.getCurrentSession).not.toHaveBeenCalled();
  });

  it("携带 Authorization 但 Bearer 无效时直接 401，不回落 Cookie", async () => {
    mocks.authorizationHeader = "Bearer ma_invalid_token";
    mocks.resolveMiniappSession.mockResolvedValue(null);
    // 即使存在有效 Cookie 会话也必须被忽略
    mocks.getCurrentSession.mockResolvedValue({
      user: { id: webActor.id },
      session: { userId: webActor.id },
    });
    const { resolveApiActor } = await import("@/modules/http/api-actor");

    const result = await resolveApiActor();

    expect(result.actor).toBeUndefined();
    expect(result.failure?.code).toBe("UNAUTHORIZED");
    expect(mocks.getCurrentSession).not.toHaveBeenCalled();
  });

  it("非 Bearer 方案的 Authorization 也按无效处理且不回落 Cookie", async () => {
    mocks.authorizationHeader = "Basic dXNlcjpwYXNz";
    mocks.resolveMiniappSession.mockResolvedValue(null);
    const { resolveApiActor } = await import("@/modules/http/api-actor");

    const result = await resolveApiActor();

    expect(result.failure?.code).toBe("UNAUTHORIZED");
    expect(mocks.getCurrentSession).not.toHaveBeenCalled();
  });

  it("未携带 Authorization 时走 Cookie 会话", async () => {
    mocks.authorizationHeader = null;
    mocks.getCurrentSession.mockResolvedValue({
      user: { id: webActor.id },
    });
    mocks.resolveActor.mockResolvedValue(webActor);
    const { resolveApiActor } = await import("@/modules/http/api-actor");

    const result = await resolveApiActor();

    expect(result).toEqual({ actor: webActor });
    expect(mocks.resolveMiniappSession).not.toHaveBeenCalled();
  });

  it("未携带 Authorization 且 Cookie 会话缺失时返回 401", async () => {
    mocks.authorizationHeader = null;
    mocks.getCurrentSession.mockResolvedValue(null);
    const { resolveApiActor } = await import("@/modules/http/api-actor");

    const result = await resolveApiActor();

    expect(result.failure?.code).toBe("UNAUTHORIZED");
  });
});
