import { describe, expect, it } from "vitest";
import {
  DEV_API_BASE_URL,
  PROD_API_BASE_URL,
  pickApiBaseUrl,
} from "../../miniapp/src/lib/api-base-url";

describe("小程序后端地址选择", () => {
  it("开发者工具连本地：模拟器跑在电脑上，127.0.0.1 即电脑本身", () => {
    expect(pickApiBaseUrl("devtools")).toBe(DEV_API_BASE_URL);
  });

  it("真机一律走生产（审核版回归：envVersion 报 develop 也不得连本地）", () => {
    for (const platform of ["ios", "android", "windows", "mac", "ohos"]) {
      expect(pickApiBaseUrl(platform)).toBe(PROD_API_BASE_URL);
    }
  });

  it("平台探测失败按真机处理，宁可连生产也不把线上流量导去本地", () => {
    expect(pickApiBaseUrl(null)).toBe(PROD_API_BASE_URL);
  });

  it("除开发者工具外没有任何取值能连到本地", () => {
    for (const platform of ["", "DEVTOOLS", "devtool", "unknown"]) {
      expect(pickApiBaseUrl(platform)).toBe(PROD_API_BASE_URL);
    }
  });

  it("联调用的临时地址不会被打包进版本", () => {
    // 真机联调时会把 PROD_API_BASE_URL 临时改成局域网 IP，忘了改回这里会失败
    expect(PROD_API_BASE_URL).toBe("https://support.achord.cn");
  });
});
