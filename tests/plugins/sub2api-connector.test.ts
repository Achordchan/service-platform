import { describe, expect, it } from "vitest";
import {
  createSub2ApiRequestIdentity,
  isPrivateHostname,
  jwtExpiryDate,
  normalizeSub2ApiBaseUrl,
  normalizeSub2ApiUser,
} from "@/modules/integrations/sub2api/client-utils";
import {
  SUB2API_CONNECTOR_PLUGIN_KEY,
  parseSub2ApiConnectorConfig,
  sub2ApiConnectorManifest,
} from "@achord/plugin-sub2api-connector";

describe("Sub2API 连接器", () => {
  it("以默认关闭的可信插件清单注册", () => {
    expect(SUB2API_CONNECTOR_PLUGIN_KEY).toBe("sub2api-connector");
    expect(sub2ApiConnectorManifest.capabilities).toContain(
      "external-identity:verify",
    );
    expect(parseSub2ApiConnectorConfig({})).toEqual({});
  });

  it("规范化 HTTPS 地址并拒绝携带凭据或查询参数", () => {
    expect(normalizeSub2ApiBaseUrl("https://sub.example.com///")).toEqual({
      baseUrl: "https://sub.example.com",
      sourceOrigin: "https://sub.example.com",
    });
    expect(() =>
      normalizeSub2ApiBaseUrl("https://user:pass@sub.example.com"),
    ).toThrow("不能包含账号");
    expect(() =>
      normalizeSub2ApiBaseUrl("https://sub.example.com?token=secret"),
    ).toThrow("不能包含账号");
  });

  it("使用外部用户 ID 作为稳定身份并兼容嵌套响应", () => {
    expect(
      normalizeSub2ApiUser({
        data: {
          user: {
            id: 42,
            email: " USER@EXAMPLE.COM ",
            username: "sub-user",
            display_name: "外部用户",
          },
        },
      }),
    ).toEqual({
      id: "42",
      email: "user@example.com",
      username: "sub-user",
      name: "外部用户",
    });
  });

  it("读取 JWT 过期时间且不接受无效载荷", () => {
    const payload = Buffer.from(JSON.stringify({ exp: 1_800_000_000 }))
      .toString("base64url");
    expect(jwtExpiryDate(`header.${payload}.signature`)?.toISOString()).toBe(
      "2027-01-15T08:00:00.000Z",
    );
    expect(jwtExpiryDate("not-a-jwt")).toBeNull();
  });
});


describe("Sub2API 网络边界", () => {
  it("固定连接已校验 IP 并保留域名 SNI 与端口", () => {
    expect(
      createSub2ApiRequestIdentity(
        new URL("https://sub.achord.cn:8443/api/v1/settings/public"),
        { address: "95.169.2.68", family: 4 },
      ),
    ).toEqual({
      hostname: "95.169.2.68",
      servername: "sub.achord.cn",
      hostHeader: "sub.achord.cn:8443",
    });
  });

  it("识别 0.0.0.0、IPv4-mapped 与链路本地地址", () => {
    expect(isPrivateHostname("0.0.0.0")).toBe(true);
    expect(isPrivateHostname("127.0.0.1")).toBe(true);
    expect(isPrivateHostname("10.1.2.3")).toBe(true);
    expect(isPrivateHostname("169.254.1.1")).toBe(true);
    expect(isPrivateHostname("::1")).toBe(true);
    expect(isPrivateHostname("fe80::1")).toBe(true);
    expect(isPrivateHostname("::ffff:127.0.0.1")).toBe(true);
    expect(isPrivateHostname("1.1.1.1")).toBe(false);
  });

  it("生产环境拒绝私网 Sub2API 地址", () => {
    const env = process.env as { NODE_ENV?: string };
    const previous = env.NODE_ENV;
    env.NODE_ENV = "production";
    try {
      expect(() => normalizeSub2ApiBaseUrl("https://127.0.0.1")).toThrow("本机或内网");
      expect(() => normalizeSub2ApiBaseUrl("https://0.0.0.0")).toThrow("本机或内网");
    } finally {
      env.NODE_ENV = previous;
    }
  });
});
