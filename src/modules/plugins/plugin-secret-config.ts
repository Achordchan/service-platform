import "server-only";

import { createHash } from "node:crypto";
import { decryptSecret, encryptSecret } from "@/lib/secret-crypto";

export function decryptPluginSecretConfig(value: string | null | undefined) {
  if (!value) return {};
  const parsed = JSON.parse(decryptSecret(value)) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("插件敏感配置格式无效");
  }
  return parsed as Record<string, unknown>;
}

export function encryptPluginSecretConfig(value: Record<string, unknown>) {
  return encryptSecret(JSON.stringify(value));
}

export function fingerprintPluginConfiguration(
  config: Record<string, unknown>,
  secrets: Record<string, unknown>,
) {
  return createHash("sha256")
    .update(stableSerialize({ config, secrets }))
    .digest("base64url");
}

function stableSerialize(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableSerialize(record[key])}`)
    .join(",")}}`;
}
