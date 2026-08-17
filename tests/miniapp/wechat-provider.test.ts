import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import { createWechatProvider } from "@/modules/miniapp/wechat-provider";

describe("微信 Provider 选择与生产防护", () => {
  it("dev Provider 在生产环境直接拒绝启用", () => {
    expect(() =>
      createWechatProvider({
        mode: "dev",
        nodeEnv: "production",
      }),
    ).toThrow(/生产环境/);
  });

  it("dev Provider 在非生产环境返回稳定 openid", async () => {
    const provider = createWechatProvider({
      mode: "dev",
      nodeEnv: "development",
      devOpenid: "dev-openid-alice",
    });
    const first = await provider.code2Session("any-code");
    const second = await provider.code2Session("other-code");
    expect(first.openid).toBe("dev-openid-alice");
    expect(second.openid).toBe(first.openid);
  });

  it("real Provider 未配置凭据时在调用期明确报错", async () => {
    const provider = createWechatProvider({ mode: "real", nodeEnv: "production" });
    await expect(provider.code2Session("code")).rejects.toMatchObject({
      code: "MINIAPP_NOT_CONFIGURED",
      status: 503,
    });
  });

  it("real Provider 将微信错误码映射为领域错误", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ errcode: 40029, errmsg: "invalid code" }), {
        status: 200,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const provider = createWechatProvider({
      mode: "real",
      appid: "wx-appid",
      secret: "wx-secret",
      nodeEnv: "production",
    });
    await expect(provider.code2Session("bad-code")).rejects.toMatchObject({
      code: "INVALID_WECHAT_CODE",
      status: 401,
    });

    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ openid: "oABC", unionid: "uABC" }), {
        status: 200,
      }),
    );
    await expect(provider.code2Session("good-code")).resolves.toEqual({
      openid: "oABC",
      unionid: "uABC",
    });
    const calledUrl = new URL(fetchMock.mock.calls[1]![0] as string);
    expect(calledUrl.searchParams.get("appid")).toBe("wx-appid");
    expect(calledUrl.searchParams.get("secret")).toBe("wx-secret");
    vi.unstubAllGlobals();
  });
});
