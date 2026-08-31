import { describe, expect, it, vi } from "vitest";

import type { AuthState } from "../../miniapp/src/lib/auth-machine";
import { handleMissingPage } from "../../miniapp/src/lib/page-not-found";
import { HOME_PAGE } from "../../miniapp/src/lib/routes";

function run(state: AuthState, path = "pages/index/index") {
  const reLaunch = vi.fn();
  const warn = vi.fn();
  handleMissingPage({ getAuthState: () => state, reLaunch, warn }, path);
  return { reLaunch, warn };
}

describe("小程序页面不存在兜底", () => {
  it("已登录：把失效路径（体验版旧二维码）跳回首页", () => {
    const { reLaunch } = run("authenticated");
    expect(reLaunch).toHaveBeenCalledWith(HOME_PAGE);
  });

  it("校验中：同样跳首页，由首页 onShow 挂起等校验结果", () => {
    const { reLaunch } = run("checking");
    expect(reLaunch).toHaveBeenCalledWith(HOME_PAGE);
  });

  it("未登录：跳首页，由首页 onShow 的单飞跳转接管去登录页", () => {
    const { reLaunch } = run("unauthenticated");
    expect(reLaunch).toHaveBeenCalledWith(HOME_PAGE);
  });

  it("登录跳转在途：让路，不盖掉 bootstrapAuth 的登录页 reLaunch", () => {
    const { reLaunch } = run("redirecting");
    expect(reLaunch).not.toHaveBeenCalled();
  });

  it("总是记录失效路径，避免应用内跳转拼错被兜底静默掩盖", () => {
    const { warn } = run("redirecting", "pages/typo/page");
    expect(warn).toHaveBeenCalledWith(expect.any(String), "pages/typo/page");
  });
});
