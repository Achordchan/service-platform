import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  decryptPluginSecretConfig,
  encryptPluginSecretConfig,
  fingerprintPluginConfiguration,
} from "@/modules/plugins/plugin-secret-config";

vi.mock("server-only", () => ({}));

beforeAll(() => {
  vi.stubEnv("DATABASE_URL", "postgresql://test:test@127.0.0.1:5432/test");
  vi.stubEnv("JOB_DATABASE_URL", "postgresql://test:test@127.0.0.1:5432/test");
  vi.stubEnv("BETTER_AUTH_SECRET", "test-auth-secret-at-least-32-characters");
  vi.stubEnv("BETTER_AUTH_URL", "http://127.0.0.1:3000");
  vi.stubEnv("APP_URL", "http://127.0.0.1:3000");
});

afterAll(() => {
  vi.unstubAllEnvs();
});

describe("插件敏感配置", () => {
  it("只保存密文并可恢复原始对象", () => {
    const input = {
      webhookUrl:
        "https://oapi.dingtalk.com/robot/send?access_token=test-token",
    };
    const encrypted = encryptPluginSecretConfig(input);

    expect(encrypted).not.toContain("test-token");
    expect(decryptPluginSecretConfig(encrypted)).toEqual(input);
  });

  it("拒绝被篡改的密文", () => {
    const encrypted = encryptPluginSecretConfig({ webhookUrl: "secret" });
    expect(() => decryptPluginSecretConfig(`${encrypted}broken`)).toThrow();
  });

  it("配置指纹忽略对象键顺序，但敏感配置变化后一定改变", () => {
    const first = fingerprintPluginConfiguration(
      { enabled: true, retries: 3 },
      { webhookUrl: "https://example.com/a", token: "one" },
    );
    const reordered = fingerprintPluginConfiguration(
      { retries: 3, enabled: true },
      { token: "one", webhookUrl: "https://example.com/a" },
    );
    const changed = fingerprintPluginConfiguration(
      { enabled: true, retries: 3 },
      { webhookUrl: "https://example.com/a", token: "two" },
    );

    expect(reordered).toBe(first);
    expect(changed).not.toBe(first);
  });
});
