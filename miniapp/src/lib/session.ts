// 登录会话协调层：把纯状态机 AuthMachine 接到 wx 副作用。
// request.ts 的 401、各页面 onShow 门禁、登录/绑定流程都经由此模块统一状态，
// 避免并发 401 各自清 token+跳转导致的 abort 风暴（审核环境首次登录失败根因）。
import { AuthMachine, type AuthState } from "./auth-machine";

const TOKEN_KEY = "miniapp_token";
const TICKET_KEY = "miniapp_binding_ticket";

/** 清除本地登录态与待绑定票据（换号/被踢/401 单飞时统一入口） */
export function clearToken() {
  wx.removeStorageSync(TOKEN_KEY);
  wx.removeStorageSync(TICKET_KEY);
}

const machine = new AuthMachine({
  clearToken,
  redirectToLogin: () => {
    wx.reLaunch({ url: "/pages/auth/login/page" });
  },
});

export function getAuthState(): AuthState {
  return machine.getState();
}

/** 启动首屏：进入身份校验中，校验完成前业务请求不得启动 */
export function beginAuthCheck() {
  machine.setChecking();
}

/** 登录/绑定成功：解锁跳转、置为已登录，并放行挂起的业务加载 */
export function markAuthenticated() {
  machine.setAuthenticated();
}

/** 无有效登录态 */
export function markUnauthenticated() {
  machine.setUnauthenticated();
}

/** 微信未绑定：需账号验证，业务请求不得启动 */
export function markBindingRequired() {
  machine.setBindingRequired();
}

/** request.ts 401 安全网：并发只清一次 token、只跳一次登录页 */
export function handleUnauthorized() {
  machine.handleUnauthorized();
}

/** 页面 onShow 门禁：见 AuthMachine.requireAuth */
export function requireAuth(onReady?: () => void): boolean {
  return machine.requireAuth(onReady);
}

export type { AuthState };
