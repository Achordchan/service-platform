import { describe, expect, it } from "vitest";
import { API_BASE_URL, pickApiBaseUrl } from "../../miniapp/src/config";

const PROD = "https://support.achord.cn";
const LOCAL = "http://127.0.0.1:3000";

describe("小程序后端地址选择", () => {
  it("开发者工具连本地：模拟器跑在电脑上，127.0.0.1 即电脑本身", () => {
    expect(pickApiBaseUrl("devtools")).toBe(LOCAL);
  });

  it("真机一律走生产（审核版回归：envVersion 报 develop 也不得连本地）", () => {
    for (const platform of ["ios", "android", "windows", "mac", "ohos"]) {
      expect(pickApiBaseUrl(platform)).toBe(PROD);
    }
  });

  it("平台探测失败按真机处理，宁可连生产也不把线上流量导去本地", () => {
    expect(pickApiBaseUrl(null)).toBe(PROD);
  });

  it("除开发者工具外没有任何取值能连到本地", () => {
    for (const platform of ["", "DEVTOOLS", "devtool", "unknown"]) {
      expect(pickApiBaseUrl(platform)).toBe(PROD);
    }
  });

  it("联调用的临时地址不会被打包进版本：无 wx 的 node 环境应落到生产", () => {
    // 等价于真机（探测失败）。若 PROD_API_BASE_URL 被临时改成局域网 IP
    // 后忘了改回，这里会失败，拦住误提交。
    expect(API_BASE_URL).toBe(PROD);
  });
});
