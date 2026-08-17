import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  env: {
    CF_TURNSTILE_SECRET_KEY: undefined as string | undefined,
    APP_URL: undefined as string | undefined,
    BETTER_AUTH_URL: undefined as string | undefined,
  },
  fetchMock: vi.fn(),
}));

vi.mock("@/lib/runtime-env", () => ({ env: mocks.env }));

beforeAll(() => {
  // 被测逻辑在 NODE_ENV=test 下短路，单测需以 development 身份执行
  vi.stubEnv("NODE_ENV", "development");
  vi.stubGlobal("fetch", mocks.fetchMock);
});

describe("Turnstile 服务端校验", () => {
  it("secret 未配置时跳过校验（本地最小配置可登录）", async () => {
    mocks.env.CF_TURNSTILE_SECRET_KEY = undefined;
    const { verifyTurnstileToken } = await import("@/lib/turnstile");
    const result = await verifyTurnstileToken(undefined);
    expect(result).toEqual({ ok: true, skipped: true });
    expect(mocks.fetchMock).not.toHaveBeenCalled();
  });

  it("缺少有效 token 时拒绝", async () => {
    mocks.env.CF_TURNSTILE_SECRET_KEY = "test-secret";
    const { verifyTurnstileToken } = await import("@/lib/turnstile");
    await expect(verifyTurnstileToken(undefined)).resolves.toEqual({
      ok: false,
      skipped: false,
    });
    await expect(verifyTurnstileToken("short")).resolves.toMatchObject({
      ok: false,
    });
  });

  it("siteverify 成功/失败/网络异常三分支", async () => {
    mocks.env.CF_TURNSTILE_SECRET_KEY = "test-secret";
    const { verifyTurnstileToken } = await import("@/lib/turnstile");
    mocks.fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, hostname: "localhost" }),
    });
    await expect(verifyTurnstileToken("valid-token-123456")).resolves.toEqual({
      ok: true,
      skipped: false,
    });
    mocks.fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: false, hostname: "localhost" }),
    });
    await expect(verifyTurnstileToken("valid-token-123456")).resolves.toMatchObject({ ok: false });
    mocks.fetchMock.mockRejectedValueOnce(new Error("network"));
    await expect(verifyTurnstileToken("valid-token-123456")).resolves.toMatchObject({ ok: false });
  });

  it("hostname 白名单：非本站签发的 token 即使 success 也拒绝", async () => {
    mocks.env.CF_TURNSTILE_SECRET_KEY = "test-secret";
    const { verifyTurnstileToken } = await import("@/lib/turnstile");
    mocks.fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, hostname: "evil.example" }),
    });
    await expect(verifyTurnstileToken("valid-token-123456")).resolves.toMatchObject({
      ok: false,
    });
    // 响应缺少 hostname：fail-closed
    mocks.fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true }),
    });
    await expect(verifyTurnstileToken("valid-token-123456")).resolves.toMatchObject({
      ok: false,
    });
  });

  it("生产环境只放行 APP_URL/BETTER_AUTH_URL 的主机名", async () => {
    mocks.env.CF_TURNSTILE_SECRET_KEY = "test-secret";
    mocks.env.APP_URL = "https://support.achord.cn";
    mocks.env.BETTER_AUTH_URL = "https://support.achord.cn";
    vi.stubEnv("NODE_ENV", "production");
    try {
      // 模块缓存 env 是 mock 对象，直接重新导入即可读取新值
      const { verifyTurnstileToken } = await import("@/lib/turnstile");
      mocks.fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, hostname: "support.achord.cn" }),
      });
      await expect(verifyTurnstileToken("valid-token-123456")).resolves.toMatchObject({
        ok: true,
      });
      mocks.fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, hostname: "localhost" }),
      });
      await expect(verifyTurnstileToken("valid-token-123456")).resolves.toMatchObject({
        ok: false,
      });
    } finally {
      vi.stubEnv("NODE_ENV", "development");
      delete mocks.env.APP_URL;
      delete mocks.env.BETTER_AUTH_URL;
    }
  });
});
