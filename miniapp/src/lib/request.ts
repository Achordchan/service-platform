import { API_BASE_URL } from "../config";

export type ApiErrorShape = { code: string; message: string };

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, body: ApiErrorShape) {
    super(body.message);
    this.status = status;
    this.code = body.code;
  }
}

type ResponseBody<T> = { data?: T; error?: ApiErrorShape };

export function request<T>(
  path: string,
  options: {
    method?: "GET" | "POST" | "PATCH" | "DELETE";
    data?: unknown;
    /** false 时不携带/不依赖登录态（登录与绑定接口） */
    auth?: boolean;
    /** 弱网防重复：随 X-Idempotency-Key 头发送，服务端按 (作者, key) 幂等 */
    idempotencyKey?: string;
    timeoutMs?: number;
  } = {},
): Promise<T> {
  const useAuth = options.auth !== false;
  return new Promise<T>((resolve, reject) => {
    const header: Record<string, string> = {
      "content-type": "application/json",
    };
    if (useAuth) {
      const token = wx.getStorageSync("miniapp_token") as string;
      if (token) header.Authorization = `Bearer ${token}`;
    }
    if (options.idempotencyKey) {
      header["X-Idempotency-Key"] = options.idempotencyKey;
    }
    wx.request({
      url: `${API_BASE_URL}${path}`,
      // wx.request 运行时支持 PATCH；官方 typings 的 method 联合类型尚未收录，借用 "GET" 字面量类型断言
      method: (options.method ?? "GET") as "GET",
      data: options.data as string | WechatMiniprogram.IAnyObject | undefined,
      header,
      timeout: options.timeoutMs ?? 15000,
      success: (res) => {
        const body = res.data as ResponseBody<T> | undefined;
        if (res.statusCode === 401 && useAuth) {
          clearToken();
          wx.reLaunch({ url: "/pages/auth/login/page" });
          reject(new ApiError(401, { code: "UNAUTHORIZED", message: "请重新登录" }));
          return;
        }
        if (res.statusCode >= 200 && res.statusCode < 300 && body && "data" in body) {
          resolve(body.data as T);
          return;
        }
        reject(
          new ApiError(
            res.statusCode,
            body?.error ?? { code: "UNKNOWN", message: "请求失败，请稍后重试" },
          ),
        );
      },
      fail: () =>
        reject(
          new ApiError(0, {
            code: "NETWORK_ERROR",
            message: "网络不可用，请检查网络后重试",
          }),
        ),
    });
  });
}

export function clearToken() {
  wx.removeStorageSync("miniapp_token");
  wx.removeStorageSync("miniapp_binding_ticket");
}
