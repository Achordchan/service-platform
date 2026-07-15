import { describe, expect, it } from "vitest";
import {
  deriveCompatibilityEncryptionKey,
  decryptSecret,
  encryptSecret,
} from "../../src/lib/secret-crypto";

const KEY = Buffer.alloc(32, 7).toString("base64");
const OTHER_KEY = Buffer.alloc(32, 9).toString("base64");

describe("secret crypto", () => {
  it("encrypts and decrypts a secret without exposing plaintext", () => {
    const encrypted = encryptSecret("re_private_key", KEY);
    expect(encrypted).not.toContain("re_private_key");
    expect(decryptSecret(encrypted, KEY)).toBe("re_private_key");
  });

  it("rejects a different master key", () => {
    const encrypted = encryptSecret("whsec_secret", KEY);
    expect(() => decryptSecret(encrypted, OTHER_KEY)).toThrow();
  });

  it("rejects tampered ciphertext", () => {
    const encrypted = encryptSecret("whsec_secret", KEY);
    const tampered = encrypted.slice(0, -1) + (encrypted.endsWith("A") ? "B" : "A");
    expect(() => decryptSecret(tampered, KEY)).toThrow();
  });

  it("derives a stable 32-byte compatibility key", () => {
    const first = deriveCompatibilityEncryptionKey("auth-secret-123");
    const second = deriveCompatibilityEncryptionKey("auth-secret-123");
    expect(first).toBe(second);
    expect(Buffer.from(first, "base64")).toHaveLength(32);
  });
});
