import { afterEach, describe, expect, it, vi } from "vitest";

const DEDICATED_KEY = Buffer.alloc(32, 11).toString("base64");
const AUTH_SECRET = "compatibility-auth-secret-with-more-than-32-characters";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("secret crypto key rotation", () => {
  it("配置专用主密钥后仍可读取由兼容密钥加密的历史密文", async () => {
    vi.stubEnv("NEXT_PHASE", "phase-production-build");
    vi.stubEnv("PLATFORM_SECRET_ENCRYPTION_KEY", DEDICATED_KEY);
    vi.stubEnv("BETTER_AUTH_SECRET", AUTH_SECRET);
    vi.resetModules();

    const {
      decryptSecret,
      deriveCompatibilityEncryptionKey,
      encryptSecret,
    } = await import("@/lib/secret-crypto");
    const encrypted = encryptSecret(
      "legacy-provider-secret",
      deriveCompatibilityEncryptionKey(AUTH_SECRET),
    );

    expect(decryptSecret(encrypted)).toBe("legacy-provider-secret");
  });

  it("显式提供错误密钥时不会回退到运行时兼容密钥", async () => {
    vi.stubEnv("NEXT_PHASE", "phase-production-build");
    vi.stubEnv("PLATFORM_SECRET_ENCRYPTION_KEY", DEDICATED_KEY);
    vi.stubEnv("BETTER_AUTH_SECRET", AUTH_SECRET);
    vi.resetModules();

    const {
      decryptSecret,
      deriveCompatibilityEncryptionKey,
      encryptSecret,
    } = await import("@/lib/secret-crypto");
    const encrypted = encryptSecret(
      "legacy-provider-secret",
      deriveCompatibilityEncryptionKey(AUTH_SECRET),
    );

    expect(() => decryptSecret(encrypted, DEDICATED_KEY)).toThrow();
  });
});
