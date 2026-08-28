import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import {
  describeUserAgent,
  isPrivateAddress,
  resolveIpLocation,
} from "@/modules/http/client-context";

describe("客户端上下文解析", () => {
  it("IP 归属地走本地 ip2region，不发外部请求", () => {
    // 国内到省市级
    expect(resolveIpLocation("114.114.114.114")).toContain("中国");
    // 海外至少到国家
    expect(resolveIpLocation("8.8.8.8")).toContain("美国");
  });

  it("内网与空值不查库，IPv6 宁可返回未知也不给错答案", () => {
    expect(isPrivateAddress("192.168.1.10")).toBe(true);
    expect(isPrivateAddress("127.0.0.1")).toBe(true);
    expect(isPrivateAddress("114.114.114.114")).toBe(false);
    expect(resolveIpLocation("192.168.1.10")).toBe("内网地址");
    expect(resolveIpLocation(null)).toBeNull();
    expect(resolveIpLocation("")).toBeNull();
    // xdb 只索引 IPv4
    expect(resolveIpLocation("2001:4860:4860::8888")).toBeNull();
  });

  it("User-Agent 解析成可读设备描述", () => {
    const ios = describeUserAgent(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.49",
    );
    expect(ios).toContain("iOS");
    const win = describeUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    );
    expect(win).toContain("Windows");
    expect(win).toContain("Chrome");
    expect(describeUserAgent(null)).toBeNull();
  });
});
