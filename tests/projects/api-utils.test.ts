import { beforeEach, describe, expect, it, vi } from "vitest";

const actorMocks = vi.hoisted(() => ({
  resolveActor: vi.fn(),
}));
const sessionMocks = vi.hoisted(() => ({
  getCurrentSession: vi.fn(),
}));

vi.mock("@/lib/actor", () => ({
  resolveActor: actorMocks.resolveActor,
}));
vi.mock("@/lib/session", () => ({
  getCurrentSession: sessionMocks.getCurrentSession,
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
