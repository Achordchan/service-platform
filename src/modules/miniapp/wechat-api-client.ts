import "server-only";

import { env } from "@/lib/runtime-env";
import { DomainError } from "@/modules/projects/errors";

// 微信服务端 API 客户端：access_token 缓存 + 订阅消息发送。
// 仅 worker 侧调用；dev Provider 下发送为空操作（不消耗真实额度）。

type AccessTokenCache = {
  token: string;
  expiresAt: number;
  refreshing: Promise<string> | null;
};

let tokenCache: AccessTokenCache | null = null;

async function fetchAccessToken(
  appid: string,
  secret: string,
): Promise<string> {
  if (tokenCache && tokenCache.expiresAt > Date.now() + 60_000) {
    return tokenCache.token;
  }
  if (tokenCache?.refreshing) return tokenCache.refreshing;

  const refreshing = (async () => {
    const url = new URL("https://api.weixin.qq.com/cgi-bin/token");
    url.searchParams.set("grant_type", "client_credential");
    url.searchParams.set("appid", appid);
    url.searchParams.set("secret", secret);
    const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
    const payload = (await response.json().catch(() => null)) as {
      access_token?: string;
      expires_in?: number;
      errcode?: number;
    } | null;
    if (!response.ok || !payload?.access_token) {
      throw new DomainError(
        "WECHAT_TOKEN_ERROR",
        "获取微信 access_token 失败",
        502,
        { errcode: payload?.errcode },
      );
    }
    tokenCache = {
      token: payload.access_token,
      // 提前 5 分钟过期，避免边界失效
      expiresAt: Date.now() + (payload.expires_in ?? 7200) * 1000 - 300_000,
      refreshing: null,
    };
    return payload.access_token;
  })();
  if (tokenCache) tokenCache.refreshing = refreshing;
  else tokenCache = { token: "", expiresAt: 0, refreshing };
  try {
    return await refreshing;
  } finally {
    if (tokenCache?.refreshing === refreshing) tokenCache.refreshing = null;
  }
}

// 微信 thing 类型字段上限 20 字符；截断时以省略号收尾
export function clipWechatThing(value: string): string {
  const clean = value.replace(/[\n\r\t]+/g, " ").trim();
  return clean.length > 20 ? `${clean.slice(0, 19)}…` : clean;
}

// 微信 phrase 类型字段上限 5 个汉字的短语（如工单状态标签）
export function clipWechatPhrase(value: string): string {
  const clean = value.replace(/\s+/g, "").trim();
  return clean.slice(0, 5);
}

/**
 * 生成不限量小程序码（wxacode.getUnlimited），scene ≤32 字符。
 * 仅 real Provider 且已配置凭据时可用；dev/未配置抛 WXA_CODE_UNAVAILABLE，
 * 调用方（Web 登录页）降级为普通 URL 二维码。
 */
export async function getWxaCodeUnlimitedBuffer(scene: string): Promise<Uint8Array> {
  if (env.MINIAPP_WECHAT_PROVIDER === "dev") {
    throw new Error("WXA_CODE_UNAVAILABLE");
  }
  const appid = env.WECHAT_MINIAPP_APPID;
  const secret = env.WECHAT_MINIAPP_APP_SECRET;
  if (!appid || !secret || scene.length > 32) {
    throw new Error("WXA_CODE_UNAVAILABLE");
  }
  let token: string;
  try {
    token = await fetchAccessToken(appid, secret);
  } catch {
    throw new Error("WXA_CODE_UNAVAILABLE");
  }
  const response = await fetch(
    `https://api.weixin.qq.com/wxa/getwxacodeunlimit?access_token=${token}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        scene,
        page: "pages/web-login/page",
        check_path: false,
        env_version: "release",
        width: 430,
      }),
      signal: AbortSignal.timeout(10_000),
    },
  );
  const contentType = response.headers.get("content-type") ?? "";
  if (!response.ok || !contentType.startsWith("image/")) {
    // 微信错误以 JSON 返回（如页面未发布 41030）
    throw new Error("WXA_CODE_UNAVAILABLE");
  }
  return new Uint8Array(await response.arrayBuffer());
}

export type WechatSendResult =
  | { outcome: "SENT" }
  | { outcome: "USER_NOT_SUBSCRIBED" }
  | { outcome: "FATAL"; errcode?: number; message: string }
  | { outcome: "RETRYABLE"; errcode?: number; message: string };

export type WechatSubscribeSender = (input: {
  openid: string;
  templateId: string;
  /** 已按模板字段布局构造的数据（键如 thing2/phrase1，值为截断后的文本） */
  data: Record<string, string>;
  page: string | null;
}) => Promise<WechatSendResult>;

export async function sendSubscribeMessageViaWechat(input: {
  openid: string;
  templateId: string;
  /** 已按模板字段布局构造的数据（键如 thing2/phrase1，值为截断后的文本） */
  data: Record<string, string>;
  page: string | null;
}): Promise<WechatSendResult> {
  if (env.MINIAPP_WECHAT_PROVIDER === "dev") {
    // dev Provider：模拟发送成功（真实额度修正依赖微信实际结果，dev 下不触发）
    return { outcome: "SENT" };
  }
  const appid = env.WECHAT_MINIAPP_APPID;
  const secret = env.WECHAT_MINIAPP_APP_SECRET;
  if (!appid || !secret) {
    return { outcome: "RETRYABLE", message: "微信小程序凭据未配置" };
  }
  let token: string;
  try {
    token = await fetchAccessToken(appid, secret);
  } catch (error) {
    return {
      outcome: "RETRYABLE",
      message: error instanceof Error ? error.message : "access_token 获取失败",
    };
  }
  try {
    const response = await fetch(
      `https://api.weixin.qq.com/cgi-bin/message/subscribe/send?access_token=${token}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          touser: input.openid,
          template_id: input.templateId,
          page: input.page ?? undefined,
          miniprogram_state: "formal",
          data: Object.fromEntries(
            Object.entries(input.data).map(([key, value]) => [
              key,
              { value },
            ]),
          ),
        }),
        signal: AbortSignal.timeout(8000),
      },
    );
    const payload = (await response.json().catch(() => null)) as {
      errcode?: number;
      errmsg?: string;
    } | null;
    if (payload?.errcode === 0) {
      return { outcome: "SENT" };
    }
    if (payload === null) {
      // 响应不是 JSON（如网关 HTML 错误页）：不可确认送达，按可重试处理
      return { outcome: "RETRYABLE", message: "微信响应格式异常" };
    }
    if (payload.errcode === 43101) {
      // 用户未订阅/已退订：额度状态失效，清零后跳过
      return { outcome: "USER_NOT_SUBSCRIBED" };
    }
    if (payload.errcode === 40003 || payload.errcode === 40037) {
      // openid 无效 / 模板无效：重试无意义，直接 FAILED
      return {
        outcome: "FATAL",
        errcode: payload.errcode,
        message: payload.errmsg ?? "微信订阅消息被拒绝",
      };
    }
    return {
      outcome: "RETRYABLE",
      errcode: payload.errcode,
      message: payload.errmsg ?? "微信订阅消息发送失败",
    };
  } catch (error) {
    return {
      outcome: "RETRYABLE",
      message: error instanceof Error ? error.message : "网络错误",
    };
  }
}
