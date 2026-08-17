import "server-only";

import { env } from "@/lib/runtime-env";
import { DomainError } from "@/modules/projects/errors";

export type WechatSessionIdentity = { openid: string; unionid?: string };

export interface WechatProvider {
  code2Session(code: string): Promise<WechatSessionIdentity>;
}

export type WechatProviderConfig = {
  mode: "real" | "dev";
  appid?: string;
  secret?: string;
  devOpenid?: string;
  nodeEnv?: string;
};

export function getWechatProvider(): WechatProvider {
  return createWechatProvider({
    mode: env.MINIAPP_WECHAT_PROVIDER,
    appid: env.WECHAT_MINIAPP_APPID,
    secret: env.WECHAT_MINIAPP_APP_SECRET,
    devOpenid: env.MINIAPP_DEV_OPENID,
    nodeEnv: process.env.NODE_ENV,
  });
}

export function createWechatProvider(
  config: WechatProviderConfig,
): WechatProvider {
  if (config.mode === "dev") {
    if (config.nodeEnv === "production") {
      throw new Error(
        "MINIAPP_WECHAT_PROVIDER=dev 在生产环境被禁止启用，请配置正式微信凭据",
      );
    }
    // devtools 里 wx.login 的 code 每次都变，dev Provider 返回稳定 openid
    // 才能模拟「登录 → 绑定 → 再次登录」闭环；多身份场景由测试注入 Provider 覆盖。
    const openid = config.devOpenid ?? "dev-openid-local";
    return { code2Session: async () => ({ openid }) };
  }
  if (!config.appid || !config.secret) {
    // 不在启动期抛错：未部署小程序的环境（纯 Web）不应因缺少微信配置而不可用。
    return {
      async code2Session() {
        throw new DomainError(
          "MINIAPP_NOT_CONFIGURED",
          "微信小程序登录尚未配置，请联系管理员",
          503,
        );
      },
    };
  }
  const { appid, secret } = config;
  return { code2Session: (code) => realCode2Session(appid, secret, code) };
}

async function realCode2Session(
  appid: string,
  secret: string,
  code: string,
): Promise<WechatSessionIdentity> {
  const url = new URL("https://api.weixin.qq.com/sns/jscode2session");
  url.searchParams.set("appid", appid);
  url.searchParams.set("secret", secret);
  url.searchParams.set("js_code", code);
  url.searchParams.set("grant_type", "authorization_code");

  let response: Response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(8000) });
  } catch {
    throw new DomainError(
      "WECHAT_API_UNAVAILABLE",
      "微信服务暂时不可用，请稍后重试",
      502,
    );
  }
  const payload = (await response.json().catch(() => null)) as {
    openid?: string;
    unionid?: string;
    errcode?: number;
  } | null;
  if (!response.ok || !payload) {
    throw new DomainError(
      "WECHAT_API_UNAVAILABLE",
      "微信服务暂时不可用，请稍后重试",
      502,
    );
  }
  if (payload.errcode) {
    if (payload.errcode === 40029 || payload.errcode === 40163) {
      throw new DomainError(
        "INVALID_WECHAT_CODE",
        "微信登录凭证无效或已使用，请重新登录",
        401,
      );
    }
    if (payload.errcode === 45011) {
      throw new DomainError(
        "WECHAT_RATE_LIMITED",
        "微信登录过于频繁，请稍后重试",
        429,
      );
    }
    throw new DomainError("WECHAT_API_ERROR", "微信登录失败，请稍后重试", 502, {
      errcode: payload.errcode,
    });
  }
  if (!payload.openid) {
    throw new DomainError("WECHAT_API_ERROR", "微信登录失败，请稍后重试", 502);
  }
  return { openid: payload.openid, unionid: payload.unionid };
}
