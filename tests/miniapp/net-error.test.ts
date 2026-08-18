import { describe, it, expect } from "vitest";
import { classifyRequestFailure } from "../../miniapp/src/lib/net-error";

// 审核环境的「网络不可用」误报根因：页面切换 reLaunch 中止在途请求（abort），
// 却被统一显示成断网。这里锁定分类逻辑，防止回归。
describe("classifyRequestFailure", () => {
  it("页面切换中止 abort → REQUEST_ABORTED，不显示为网络问题", () => {
    const info = classifyRequestFailure("request:fail abort");
    expect(info.code).toBe("REQUEST_ABORTED");
    expect(info.message).not.toContain("网络");
  });

  it("超时 → REQUEST_TIMEOUT", () => {
    expect(classifyRequestFailure("request:fail timeout").code).toBe(
      "REQUEST_TIMEOUT",
    );
  });

  it("真实断网 request:fail → NETWORK_ERROR", () => {
    const info = classifyRequestFailure("request:fail");
    expect(info.code).toBe("NETWORK_ERROR");
    expect(info.message).toContain("网络");
  });

  it("未知 / 空 errMsg → REQUEST_FAILED，不误报网络不可用", () => {
    expect(classifyRequestFailure(undefined).code).toBe("REQUEST_FAILED");
    expect(classifyRequestFailure("").code).toBe("REQUEST_FAILED");
    expect(classifyRequestFailure(undefined).message).not.toContain("网络");
  });

  it("errMsg 同时含 fail 与 abort 时，abort 优先", () => {
    expect(classifyRequestFailure("request:fail abort").code).toBe(
      "REQUEST_ABORTED",
    );
  });
});
