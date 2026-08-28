import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { clientIpFromHeaders } = await import("@/lib/request-network");

describe("clientIpFromHeaders", () => {
  it("取 x-forwarded-for 的最右段（nginx 追加、不可伪造）并去空白", () => {
    const headers = new Headers({
      "x-forwarded-for": "203.0.113.7, 10.0.0.1, 172.16.0.1",
    });
    expect(clientIpFromHeaders(headers)).toBe("172.16.0.1");
  });

  it("忽略客户端伪造的 XFF 首段，仍取最右可信段", () => {
    const headers = new Headers({
      "x-forwarded-for": "1.2.3.4 (forged), 203.0.113.7",
    });
    expect(clientIpFromHeaders(headers)).toBe("203.0.113.7");
  });

  it("无 x-forwarded-for 时回退 x-real-ip", () => {
    const headers = new Headers({ "x-real-ip": "198.51.100.42" });
    expect(clientIpFromHeaders(headers)).toBe("198.51.100.42");
  });

  it("两者皆无返回 null", () => {
    expect(clientIpFromHeaders(new Headers())).toBeNull();
  });

  it("x-forwarded-for 为空串时不误用，回退 x-real-ip", () => {
    const headers = new Headers({
      "x-forwarded-for": "   ",
      "x-real-ip": "198.51.100.9",
    });
    expect(clientIpFromHeaders(headers)).toBe("198.51.100.9");
  });
});
