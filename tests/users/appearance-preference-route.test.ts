import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireApiActor: vi.fn(),
  readJson: vi.fn(),
  updateAppearancePreference: vi.fn(),
}));

vi.mock("@/modules/projects/api-utils", () => ({
  requireApiActor: mocks.requireApiActor,
  readJson: mocks.readJson,
  routeError: (error: { message?: string; status?: number }) =>
    Response.json(
      { error: { message: error.message ?? "服务器处理失败" } },
      { status: error.status ?? 500 },
    ),
}));

vi.mock("@/modules/users/appearance-preference-service", () => ({
  appearancePreferenceSchema: {
    parse: (value: unknown) => value,
  },
  getAppearancePreference: vi.fn(),
  updateAppearancePreference: mocks.updateAppearancePreference,
}));

describe("外观设置接口", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireApiActor.mockResolvedValue({
      actor: {
        id: "customer-1",
        name: "测试客户",
        email: "customer@example.test",
        platformRole: "CUSTOMER",
        isPlatformAdmin: false,
        isStaff: false,
      },
    });
    mocks.readJson.mockResolvedValue({ themePreference: "DARK" });
    mocks.updateAppearancePreference.mockResolvedValue({
      themePreference: "DARK",
    });
  });

  it("限制外观设置请求体大小", async () => {
    const { PATCH } = await import(
      "@/app/api/v1/me/appearance-preference/route"
    );
    const request = new Request(
      "http://localhost/api/v1/me/appearance-preference",
      {
        method: "PATCH",
        body: JSON.stringify({ themePreference: "DARK" }),
      },
    );

    const response = await PATCH(request);

    expect(response.status).toBe(200);
    expect(mocks.readJson).toHaveBeenCalledWith(request, {
      maxBytes: 4 * 1024,
    });
    expect(mocks.updateAppearancePreference).toHaveBeenCalledWith(
      expect.objectContaining({ id: "customer-1" }),
      { themePreference: "DARK" },
    );
  });
});
