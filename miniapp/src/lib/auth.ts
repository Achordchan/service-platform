import { eventSync } from "./events";
import { ApiError, clearToken, request } from "./request";

const TOKEN_KEY = "miniapp_token";
const TICKET_KEY = "miniapp_binding_ticket";

export type MiniappUser = { id: string; name: string; email: string };

export type LoginResult =
  | { status: "SESSION_ISSUED"; token: string }
  | { status: "NEED_BINDING"; bindingTicket: string };

export type BindResult = { token: string; user: MiniappUser };

export type MiniappMe = {
  user: MiniappUser;
  wechatBinding: { boundAt: string; lastLoginAt: string | null } | null;
  customerSpaces: Array<{
    id: string;
    name: string;
    role: "OWNER" | "MEMBER";
  }>;
};

export function getToken(): string {
  return (wx.getStorageSync(TOKEN_KEY) as string) || "";
}

export function saveToken(token: string) {
  wx.setStorageSync(TOKEN_KEY, token);
  wx.removeStorageSync(TICKET_KEY);
  clearCachedMe();
  // 任何 token 变化（登录/绑定/被踢后重登）都意味着身份切换：重置事件游标，
  // 避免新账号从旧游标继续而跳过存量事件
  eventSync.reset();
}

export function getBindingTicket(): string {
  return (wx.getStorageSync(TICKET_KEY) as string) || "";
}

function saveBindingTicket(ticket: string) {
  wx.setStorageSync(TICKET_KEY, ticket);
}

export function isLoggedIn(): boolean {
  return Boolean(getToken());
}

/** 未登录时统一跳转登录页（Tab 页 onShow 调用） */
export function ensureLoggedIn(): boolean {
  if (isLoggedIn()) return true;
  wx.reLaunch({ url: "/pages/auth/login/page" });
  return false;
}

function wechatCode(): Promise<string> {
  return new Promise((resolve, reject) => {
    wx.login({
      success: (result) => resolve(result.code),
      fail: () => reject(new ApiError(0, { code: "WECHAT_LOGIN_FAILED", message: "微信登录失败，请重试" })),
    });
  });
}

export async function loginWithWechat(): Promise<LoginResult> {
  const code = await wechatCode();
  const result = await request<LoginResult>("/api/miniapp/auth/session", {
    method: "POST",
    data: { code },
    auth: false,
  });
  if (result.status === "SESSION_ISSUED") {
    saveToken(result.token);
  } else {
    saveBindingTicket(result.bindingTicket);
  }
  return result;
}

export async function bindWithAccount(input: {
  email: string;
  password?: string;
  otp?: string;
}): Promise<BindResult> {
  const result = await request<BindResult>("/api/miniapp/auth/bind/account", {
    method: "POST",
    data: { bindingTicket: getBindingTicket(), ...input },
    auth: false,
  });
  saveToken(result.token);
  return result;
}

export async function sendBindOtp(email: string): Promise<void> {
  await request<{ sent: true }>("/api/miniapp/auth/bind/otp/send", {
    method: "POST",
    data: { bindingTicket: getBindingTicket(), email },
    auth: false,
  });
}

export async function bindWithCode(code: string): Promise<BindResult> {
  const result = await request<BindResult>("/api/miniapp/auth/bind/code", {
    method: "POST",
    data: { bindingTicket: getBindingTicket(), code },
    auth: false,
  });
  saveToken(result.token);
  return result;
}

let cachedMe: MiniappMe | null = null;

/**
 * 邮箱登录：为习惯邮箱的老客户提供入口。
 * 内部链路：wx.login → session 探测 →
 *   已绑定：直接获得会话（该微信已是老用户，顺滑进入）
 *   未绑定：用邮箱凭据（密码或验证码）完成验证并自动绑定当前微信
 * 验证成功即建立绑定，之后可直接「微信一键登录」。
 */
export async function loginWithEmail(input: {
  email: string;
  password?: string;
  otp?: string;
}): Promise<{ alreadyBound: boolean; user?: MiniappUser }> {
  const code = await wechatCode();
  const probe = await request<LoginResult>("/api/miniapp/auth/session", {
    method: "POST",
    data: { code },
    auth: false,
  });
  if (probe.status === "SESSION_ISSUED") {
    saveToken(probe.token);
    return { alreadyBound: true };
  }
  saveBindingTicket(probe.bindingTicket);
  const result = await bindWithAccount(input);
  return { alreadyBound: false, user: result.user };
}

/** 邮箱登录前的验证码发送（内部先确保有待绑定票据） */
export async function sendLoginOtp(email: string): Promise<void> {
  let ticket = getBindingTicket();
  if (!ticket) {
    const code = await wechatCode();
    const probe = await request<LoginResult>("/api/miniapp/auth/session", {
      method: "POST",
      data: { code },
      auth: false,
    });
    if (probe.status === "SESSION_ISSUED") {
      // 已绑定用户无需验证码
      return;
    }
    ticket = probe.bindingTicket;
    saveBindingTicket(ticket);
  }
  await sendBindOtp(email);
}

export async function fetchMe(): Promise<MiniappMe> {
  return request<MiniappMe>("/api/miniapp/me");
}

/** 带缓存的当前用户信息（登录/换号后由 saveToken 清空），用于 isMine 等比对 */
export async function fetchMeCached(): Promise<MiniappMe> {
  if (cachedMe) return cachedMe;
  cachedMe = await fetchMe();
  return cachedMe;
}

export function clearCachedMe() {
  cachedMe = null;
}

export async function logout() {
  try {
    await request("/api/miniapp/auth/session", { method: "DELETE" });
  } catch {
    // 服务端撤销失败也允许本地退出
  }
  clearToken();
  clearCachedMe();
  // 换号场景：旧游标对新账号无意义，重置避免跳过事件
  eventSync.reset();
}
