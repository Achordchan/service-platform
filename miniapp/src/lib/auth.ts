import { eventSync } from "./events";
import { ApiError, request } from "./request";
import {
  beginAuthCheck,
  cancelAuthWaiter,
  clearToken,
  markAuthenticated,
  markBindingRequired,
  markUnauthenticated,
  requireAuth,
} from "./session";

const TOKEN_KEY = "miniapp_token";
const TICKET_KEY = "miniapp_binding_ticket";
const PENDING_WEB_LOGIN_KEY = "miniapp_pending_web_login";
// 网页码本身短时有效，暂存票据也设 5 分钟上限，逾期不再回跳，避免陈旧票据劫持后续普通登录
const PENDING_WEB_LOGIN_TTL = 5 * 60 * 1000;

type PendingWebLogin = { token: string; ts: number };

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
  // 拿到会话即已登录：解锁跳转锁并置为已登录，放行挂起的业务加载
  markAuthenticated();
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

/**
 * 页面 onShow 门禁（Tab 页与详情页调用）。返回是否可以立即启动业务请求。
 * - 已登录：返回 true，调用方立即加载
 * - 校验中（启动首屏）：返回 false，并挂起 onReady，待校验通过后自动执行
 * - 未绑定 / 正在跳转：返回 false，不启动业务请求，也不重复跳转
 * - 未登录：单飞跳转登录页
 */
export function ensureLoggedIn(onReady?: () => void): boolean {
  return requireAuth(onReady);
}

/**
 * 取消 ensureLoggedIn 挂起的 onReady：启动 SSE 的页面在 onHide/onUnload 调用，
 * 避免校验完成后唤醒已隐藏页面的 activate（SSE 计数与监听器泄漏）。
 */
export function cancelPendingActivate(onReady: () => void) {
  cancelAuthWaiter(onReady);
}

/**
 * 启动首屏身份校验（app.onLaunch 调用一次）。
 * 校验完成前状态为 checking，业务请求不得启动（各页 onShow 挂起等待）。
 * - 无本地 token：置未登录并跳登录页
 * - token 有效：置已登录，放行挂起的加载
 * - token 失效(401)：request 层单飞已清 token 并跳登录页
 * - 弱网等无法确认：乐观置已登录，真失效由后续单飞 401 纠正
 */
export async function bootstrapAuth(): Promise<void> {
  if (!getToken()) {
    markUnauthenticated();
    requireAuth();
    return;
  }
  beginAuthCheck();
  try {
    await fetchMe();
    markAuthenticated();
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      // 401 已由 request.ts 单飞处理（clearToken + reLaunch），状态已置 redirecting
      return;
    }
    markAuthenticated();
  }
}

/**
 * 扫码进入网页登录确认页时暂存票据：未登录需先跳登录页（reLaunch 会销毁确认页），
 * 登录成功后据此回跳完成确认，避免票据随页面销毁而丢失、被迫重新扫码。
 */
export function savePendingWebLogin(token: string) {
  const payload: PendingWebLogin = { token, ts: Date.now() };
  wx.setStorageSync(PENDING_WEB_LOGIN_KEY, payload);
}

/** 读取暂存的网页登录票据；逾期自动清除并返回空 */
export function getPendingWebLogin(): string {
  const payload = wx.getStorageSync(PENDING_WEB_LOGIN_KEY) as
    | PendingWebLogin
    | "";
  if (!payload || typeof payload !== "object") return "";
  if (Date.now() - payload.ts > PENDING_WEB_LOGIN_TTL) {
    clearPendingWebLogin();
    return "";
  }
  return payload.token;
}

export function clearPendingWebLogin() {
  wx.removeStorageSync(PENDING_WEB_LOGIN_KEY);
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
    // 微信未绑定：进入账号验证态，业务请求（项目/工单/通知/Badge/SSE）不得启动
    saveBindingTicket(result.bindingTicket);
    markBindingRequired();
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
    // 该微信已绑定某账号：微信身份是「一微信一账号」，此处必须校验签发的会话
    // 与用户输入的邮箱一致，否则是「已绑其他账号」——不能静默把用户登进别的号。
    saveToken(probe.token);
    let boundEmail = "";
    try {
      const me = await fetchMe();
      boundEmail = me.user.email;
    } catch {
      // 拉取身份失败无法校验：会话已合法签发，放行避免误伤（弱网等边界）
      return { alreadyBound: true };
    }
    if (boundEmail.trim().toLowerCase() !== input.email.trim().toLowerCase()) {
      await logout();
      throw new ApiError(0, {
        code: "WECHAT_BOUND_TO_OTHER",
        message:
          "当前微信已绑定其他账号，无法用该邮箱登录。如需切换账号，请联系客服解绑后重试。",
      });
    }
    return { alreadyBound: true };
  }
  saveBindingTicket(probe.bindingTicket);
  const result = await bindWithAccount(input);
  return { alreadyBound: false, user: result.user };
}

/**
 * 确保存在待绑定票据：绑定码/邮箱绑定都要求先有票据。
 * 无票据时用 wx.login 探测建立；若该微信已绑定账号则直接登入并返回 ALREADY_BOUND，
 * 调用方据此跳过绑定码直接进入（无需再输码）。
 */
export async function ensureBindingTicket(): Promise<
  { status: "READY" } | { status: "ALREADY_BOUND" }
> {
  if (getBindingTicket()) return { status: "READY" };
  const code = await wechatCode();
  const probe = await request<LoginResult>("/api/miniapp/auth/session", {
    method: "POST",
    data: { code },
    auth: false,
  });
  if (probe.status === "SESSION_ISSUED") {
    saveToken(probe.token);
    return { status: "ALREADY_BOUND" };
  }
  saveBindingTicket(probe.bindingTicket);
  markBindingRequired();
  return { status: "READY" };
}

/**
 * 绑定票据过期后重建：清旧票据，重新 wx.login + session 探测取新票据。
 * 供绑定接口返回 BINDING_TICKET_INVALID 时调用，避免用户停留在持有失效票据的页面。
 */
export async function refreshBindingTicket(): Promise<
  { status: "READY" } | { status: "ALREADY_BOUND" }
> {
  wx.removeStorageSync(TICKET_KEY);
  return ensureBindingTicket();
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
  markUnauthenticated();
  // 换号场景：旧游标对新账号无意义，重置避免跳过事件
  eventSync.reset();
}
