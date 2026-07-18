import {
  extractExternalClientFingerprint,
  type ExternalClientFingerprint,
} from "@/modules/integrations/external/client-fingerprint";
import {
  isDevelopmentLocalHostname,
  isPrivateHostname,
} from "@/modules/integrations/external/network-security";
import { DomainError } from "@/modules/projects/errors";

type JsonRecord = Record<string, unknown>;

export type Sub2ApiUser = {
  id: string;
  email: string | null;
  username: string | null;
  name: string;
};

export type Sub2ApiPinnedAddress = {
  address: string;
  family: number;
};

export type Sub2ApiClientFingerprint = ExternalClientFingerprint;

export function extractSub2ApiClientFingerprint(headers: Headers) {
  return extractExternalClientFingerprint(headers);
}

export function createSub2ApiRequestIdentity(
  target: URL,
  pinned: Sub2ApiPinnedAddress | null,
) {
  return {
    hostname: pinned?.address ?? target.hostname,
    servername: target.hostname,
    hostHeader: target.host,
  };
}

export {
  isDevelopmentLocalHostname,
  isPrivateHostname,
} from "@/modules/integrations/external/network-security";

export function normalizeSub2ApiBaseUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new DomainError("INVALID_SUB2API_URL", "Sub2API 地址格式不正确", 422);
  }
  const developmentLocal = isDevelopmentLocalHostname(url.hostname);
  if (isPrivateHostname(url.hostname) && !developmentLocal) {
    throw new DomainError(
      "SUB2API_PRIVATE_ADDRESS_REJECTED",
      "Sub2API 地址不能指向本机或内网地址",
      422,
    );
  }
  if (url.protocol !== "https:" && !(developmentLocal && url.protocol === "http:")) {
    throw new DomainError(
      "SUB2API_HTTPS_REQUIRED",
      "生产环境中的 Sub2API 地址必须使用 HTTPS",
      422,
    );
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new DomainError(
      "INVALID_SUB2API_URL",
      "Sub2API 地址不能包含账号、查询参数或片段",
      422,
    );
  }
  url.pathname = url.pathname.replace(/\/+$/, "");
  return {
    baseUrl: url.toString().replace(/\/$/, ""),
    sourceOrigin: url.origin,
  };
}

function unwrap(payload: unknown): JsonRecord {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return {};
  const record = payload as JsonRecord;
  const data = record.data;
  if (data && typeof data === "object" && !Array.isArray(data)) {
    return data as JsonRecord;
  }
  return record;
}

export function normalizeSub2ApiUser(payload: unknown): Sub2ApiUser {
  const data = unwrap(payload);
  const nested = data.user;
  const user = nested && typeof nested === "object" && !Array.isArray(nested)
    ? nested as JsonRecord
    : data;
  const id = String(user.id ?? "").trim();
  if (!id) {
    throw new DomainError("SUB2API_USER_INVALID", "Sub2API 用户信息缺少 ID", 502);
  }
  const email = typeof user.email === "string" && user.email.trim()
    ? user.email.trim().toLowerCase()
    : null;
  const username = typeof user.username === "string" && user.username.trim()
    ? user.username.trim()
    : null;
  const explicitName = [user.name, user.display_name, user.displayName]
    .find((item) => typeof item === "string" && item.trim());
  return {
    id,
    email,
    username,
    name: typeof explicitName === "string"
      ? explicitName.trim()
      : username || email || `Sub2API 用户 ${id}`,
  };
}

export function jwtExpiryDate(token: string) {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { exp?: unknown };
    return typeof parsed.exp === "number" ? new Date(parsed.exp * 1000) : null;
  } catch {
    return null;
  }
}
