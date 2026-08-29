import { describe, it, expect, vi } from "vitest";
import { AuthMachine } from "../../miniapp/src/lib/auth-machine";

function makeMachine() {
  const clearToken = vi.fn();
  const redirectToLogin = vi.fn();
  const onSessionEnd = vi.fn();
  const machine = new AuthMachine({
    clearToken,
    redirectToLogin,
    onSessionEnd,
  });
  return { machine, clearToken, redirectToLogin, onSessionEnd };
}

describe("AuthMachine 登录状态机", () => {
  it("启动 checking：requireAuth 挂起 onReady、不放行业务请求、不跳转", () => {
    const { machine, redirectToLogin } = makeMachine();
    const onReady = vi.fn();
    expect(machine.getState()).toBe("checking");
    expect(machine.requireAuth(onReady)).toBe(false);
    expect(onReady).not.toHaveBeenCalled();
    expect(redirectToLogin).not.toHaveBeenCalled();
  });

  it("checking → authenticated：挂起的业务加载只放行一次", () => {
    const { machine } = makeMachine();
    const onReady = vi.fn();
    machine.requireAuth(onReady);
    machine.setAuthenticated();
    expect(onReady).toHaveBeenCalledTimes(1);
    // 后续状态变化不得重复触发旧 waiter（业务接口只加载一次）
    machine.setAuthenticated();
    expect(onReady).toHaveBeenCalledTimes(1);
  });

  it("已登录：requireAuth 直接放行，不入队 onReady", () => {
    const { machine } = makeMachine();
    machine.setAuthenticated();
    const onReady = vi.fn();
    expect(machine.requireAuth(onReady)).toBe(true);
    machine.setAuthenticated();
    expect(onReady).not.toHaveBeenCalled();
  });

  it("无本地 token（unauthenticated）：单飞跳登录页，业务请求不启动", () => {
    const { machine, redirectToLogin } = makeMachine();
    machine.setUnauthenticated();
    expect(machine.requireAuth()).toBe(false);
    expect(machine.requireAuth()).toBe(false);
    // 单飞：多次进入只跳一次
    expect(redirectToLogin).toHaveBeenCalledTimes(1);
  });

  it("并发 401：只清一次 token、只执行一次 reLaunch", () => {
    const { machine, clearToken, redirectToLogin } = makeMachine();
    machine.setAuthenticated();
    machine.handleUnauthorized();
    machine.handleUnauthorized();
    machine.handleUnauthorized();
    expect(clearToken).toHaveBeenCalledTimes(1);
    expect(redirectToLogin).toHaveBeenCalledTimes(1);
    expect(machine.getState()).toBe("redirecting");
  });

  it("微信未绑定（binding_required）：不放行业务请求，也不跳转", () => {
    const { machine, redirectToLogin } = makeMachine();
    machine.setBindingRequired();
    expect(machine.requireAuth(vi.fn())).toBe(false);
    expect(redirectToLogin).not.toHaveBeenCalled();
    expect(machine.getState()).toBe("binding_required");
  });

  it("取消挂起的 waiter：页面隐藏后 setAuthenticated 不再唤醒它（防 SSE 泄漏）", () => {
    const { machine } = makeMachine();
    const hiddenPageActivate = vi.fn();
    const visiblePageActivate = vi.fn();
    machine.requireAuth(hiddenPageActivate);
    machine.requireAuth(visiblePageActivate);
    // 隐藏页在校验完成前 onHide 取消自己的 waiter
    machine.cancelWaiter(hiddenPageActivate);
    machine.setAuthenticated();
    expect(hiddenPageActivate).not.toHaveBeenCalled();
    expect(visiblePageActivate).toHaveBeenCalledTimes(1);
  });

  it("重新登录后解锁单飞：可再次触发跳转", () => {
    const { machine, redirectToLogin } = makeMachine();
    machine.setAuthenticated();
    machine.handleUnauthorized();
    machine.setAuthenticated();
    machine.handleUnauthorized();
    expect(redirectToLogin).toHaveBeenCalledTimes(2);
  });

  it("401 被踢：归还全局副作用（角标的常驻 SSE 租约），并发只归还一次", () => {
    const { machine, clearToken, onSessionEnd } = makeMachine();
    machine.setAuthenticated();
    machine.handleUnauthorized();
    machine.handleUnauthorized();
    expect(clearToken).toHaveBeenCalledTimes(1);
    // 不归还的话，常驻租约会让旧的已鉴权 SSE 活到超时，之后还在登录页空 token 重连
    expect(onSessionEnd).toHaveBeenCalledTimes(1);
  });

  it("重新登录后再 401：租约可以再次归还", () => {
    const { machine, onSessionEnd } = makeMachine();
    machine.handleUnauthorized();
    machine.setAuthenticated();
    machine.handleUnauthorized();
    expect(onSessionEnd).toHaveBeenCalledTimes(2);
  });
});
