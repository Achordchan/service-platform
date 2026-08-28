// 登录状态机 + 跳转单飞锁。纯逻辑、不引用 wx（副作用经依赖注入），便于单元测试。
//
// 解决审核环境首次登录失败的核心：未绑定/未登录时多个业务请求并发 401，
// 若每个 401 都各自 clearToken + reLaunch，会互相打断在途 wx.request 产生 abort，
// 被统一显示成「网络不可用」。这里用单飞锁保证：并发 401 只清一次 token、只跳一次登录页。

export type AuthState =
  | "checking" // 正在校验本地登录态（启动首屏）
  | "authenticated" // 登录态有效
  | "unauthenticated" // 无有效登录态
  | "binding_required" // 微信未绑定，需账号验证
  | "redirecting"; // 正在跳转登录页（单飞进行中）

export type AuthMachineDeps = {
  clearToken: () => void;
  redirectToLogin: () => void;
  /**
   * 会话结束（被踢下线）时归还全局副作用，如角标持有的常驻 SSE 租约。
   * 与 clearToken 一样受单飞锁保护：并发 401 只触发一次。
   */
  onSessionEnd?: () => void;
};

export class AuthMachine {
  private state: AuthState = "checking";
  private redirecting = false;
  private readyWaiters = new Set<() => void>();

  constructor(private readonly deps: AuthMachineDeps) {}

  getState(): AuthState {
    return this.state;
  }

  setChecking() {
    this.state = "checking";
  }

  setAuthenticated() {
    this.redirecting = false;
    this.state = "authenticated";
    this.flushReady();
  }

  setUnauthenticated() {
    this.redirecting = false;
    this.state = "unauthenticated";
    this.readyWaiters.clear();
  }

  setBindingRequired() {
    // 未绑定不是「已登录」，业务请求必须停下；但不进入跳转（停在登录/绑定页）
    this.redirecting = false;
    this.state = "binding_required";
    this.readyWaiters.clear();
  }

  /** 并发 401 安全网：只清一次 token、只跳一次登录页 */
  handleUnauthorized() {
    if (this.redirecting) return;
    this.redirecting = true;
    this.state = "redirecting";
    this.readyWaiters.clear();
    this.deps.clearToken();
    this.deps.onSessionEnd?.();
    this.deps.redirectToLogin();
  }

  /**
   * 页面 onShow 门禁：返回是否可以立即启动业务请求。
   * - authenticated：可以
   * - checking：登录态未定，先挂起 onReady，待校验通过再执行；期间不启动业务请求
   * - binding_required / redirecting：不启动业务请求，也不重复跳转
   * - unauthenticated：单飞跳转登录页
   */
  requireAuth(onReady?: () => void): boolean {
    if (this.state === "authenticated") return true;
    if (this.state === "checking") {
      if (onReady) this.readyWaiters.add(onReady);
      return false;
    }
    if (this.state === "binding_required" || this.state === "redirecting") {
      return false;
    }
    // unauthenticated：跳登录（单飞，避免重复 reLaunch）
    if (!this.redirecting) {
      this.redirecting = true;
      this.state = "redirecting";
      this.deps.redirectToLogin();
    }
    return false;
  }

  /**
   * 取消挂起的 onReady：页面在校验完成前被 onHide/onUnload 时调用，
   * 避免已隐藏页面稍后被 flush 唤醒而启动 SSE（activePages 计数与监听器泄漏）。
   */
  cancelWaiter(onReady: () => void) {
    this.readyWaiters.delete(onReady);
  }

  private flushReady() {
    const waiters = [...this.readyWaiters];
    this.readyWaiters.clear();
    for (const waiter of waiters) waiter();
  }
}
