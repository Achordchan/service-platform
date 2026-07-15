import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from "node:crypto";
import { env } from "@/lib/runtime-env";

const VERSION = "v1";
const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;

function defaultEncodedKey() {
  if (env.PLATFORM_SECRET_ENCRYPTION_KEY) {
    return env.PLATFORM_SECRET_ENCRYPTION_KEY;
  }
  return deriveCompatibilityEncryptionKey(env.BETTER_AUTH_SECRET);
}

export function deriveCompatibilityEncryptionKey(authSecret: string) {
  return Buffer.from(
    hkdfSync(
      "sha256",
      authSecret,
      "service-platform-secret-encryption",
      "mail-provider-credentials",
      32,
    ),
  ).toString("base64");
}

function decodeKey(encodedKey: string) {
  const key = Buffer.from(encodedKey, "base64");
  if (key.length !== 32) {
    throw new Error("平台密钥加密主密钥无效");
  }
  return key;
}

export function encryptSecret(
  plaintext: string,
  encodedKey = defaultEncodedKey(),
) {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, decodeKey(encodedKey), iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);

  return [
    VERSION,
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    encrypted.toString("base64url"),
  ].join(":");
}

export function decryptSecret(
  value: string,
  encodedKey = defaultEncodedKey(),
) {
  const [version, ivValue, tagValue, encryptedValue, extra] = value.split(":");
  if (
    version !== VERSION ||
    !ivValue ||
    !tagValue ||
    encryptedValue === undefined ||
    extra !== undefined
  ) {
    throw new Error("加密密文格式无效");
  }

  const decipher = createDecipheriv(
    ALGORITHM,
    decodeKey(encodedKey),
    Buffer.from(ivValue, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedValue, "base64url")),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}
