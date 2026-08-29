import { beforeEach, describe, expect, it, vi } from "vitest";

const actorMocks = vi.hoisted(() => ({
  resolveActor: vi.fn(),
}));
const sessionMocks = vi.hoisted(() => ({
  getCurrentSession: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  headers: async () => ({ get: () => null }),
}));
vi.mock("@/lib/actor", () => ({
  resolveActor: actorMocks.resolveActor,
}));
vi.mock("@/lib/session", () => ({
  getCurrentSession: sessionMocks.getCurrentSession,
}));
vi.mock("@/modules/miniapp/session", () => ({
  resolveMiniappSessionFromAuthorization: vi.fn().mockResolvedValue(null),
}));

describe("API 登录用户解析", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("解析用户时发生基础设施错误会返回可关联编号", async () => {
    sessionMocks.getCurrentSession.mockResolvedValue({
      user: { id: "user_1" },
    });
    actorMocks.resolveActor.mockRejectedValue(
      new Error("The column `User.missing` does not exist"),
    );
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const { requireApiActor } = await import("@/modules/projects/api-utils");

    const result = await requireApiActor();

    expect(result.response?.status).toBe(500);
    expect(result.response?.headers.get("X-Achord-Error-Id")).toMatch(
      /^err_[a-f0-9]{32}$/,
    );
    await expect(result.response?.json()).resolves.toMatchObject({
      error: {
        code: "INTERNAL_ERROR",
        referenceId: result.response?.headers.get("X-Achord-Error-Id"),
      },
    });
    const logged = String(consoleError.mock.calls[0]?.[1]);
    expect(logged).toContain('"operation":"api_actor.resolve"');
    expect(logged).toContain('"missingColumn":"User.missing"');
    consoleError.mockRestore();
  });
});

describe("可选 JSON 请求体", () => {
  it("空体按不带载荷处理，DELETE 才能既支持带覆盖也支持不带", async () => {
    const { readOptionalJson } = await import("@/modules/projects/api-utils");

    await expect(
      readOptionalJson(new Request("https://test.local", { method: "DELETE" })),
    ).resolves.toEqual({});
  });

  it("带载荷时照常解析", async () => {
    const { readOptionalJson } = await import("@/modules/projects/api-utils");

    await expect(
      readOptionalJson(
        new Request("https://test.local", {
          method: "DELETE",
          body: JSON.stringify({ deliveryOverride: { notification: false } }),
        }),
      ),
    ).resolves.toEqual({ deliveryOverride: { notification: false } });
  });

  it("载荷是坏 JSON 时报错，而不是当成没传静默放过", async () => {
    const { readOptionalJson } = await import("@/modules/projects/api-utils");

    await expect(
      readOptionalJson(
        new Request("https://test.local", { method: "DELETE", body: "{oops" }),
      ),
    ).rejects.toMatchObject({ code: "INVALID_JSON", status: 400 });
  });

  it("载荷超限时按 413 拒绝", async () => {
    const { readOptionalJson } = await import("@/modules/projects/api-utils");

    await expect(
      readOptionalJson(
        new Request("https://test.local", {
          method: "DELETE",
          body: JSON.stringify({ note: "x".repeat(64) }),
        }),
        { maxBytes: 16 },
      ),
    ).rejects.toMatchObject({ code: "REQUEST_BODY_TOO_LARGE", status: 413 });
  });
});
