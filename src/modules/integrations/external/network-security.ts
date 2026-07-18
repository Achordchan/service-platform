import { isIP } from "node:net";
import { DomainError } from "@/modules/projects/errors";

export function isPrivateHostname(hostname: string) {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized.endsWith(".local") ||
    normalized.endsWith(".internal")
  ) {
    return true;
  }
  const mapped = normalized.match(
    /^(?::ffff:|::ffff:)(\d+\.\d+\.\d+\.\d+)$/i,
  );
  if (mapped) return isPrivateHostname(mapped[1]);
  if (isIP(normalized) === 4) {
    const parts = normalized.split(".").map(Number);
    if (parts.length !== 4 || parts.some((part) => Number.isNaN(part))) {
      return true;
    }
    return (
      parts[0] === 0 ||
      parts[0] === 10 ||
      parts[0] === 127 ||
      (parts[0] === 169 && parts[1] === 254) ||
      (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
      (parts[0] === 192 && parts[1] === 168) ||
      (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) ||
      (parts[0] === 198 && (parts[1] === 18 || parts[1] === 19)) ||
      parts[0] >= 224
    );
  }
  if (isIP(normalized) === 6) {
    if (normalized === "::" || normalized === "::1") return true;
    return (
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      normalized.startsWith("fe8") ||
      normalized.startsWith("fe9") ||
      normalized.startsWith("fea") ||
      normalized.startsWith("feb") ||
      normalized.startsWith("::ffff:")
    );
  }
  return false;
}

export function isDevelopmentLocalHostname(hostname: string) {
  return process.env.NODE_ENV !== "production" && isPrivateHostname(hostname);
}

export function normalizeEmbedOrigin(value: string) {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new DomainError(
      "INVALID_EMBED_ORIGIN",
      "允许嵌入的 Origin 格式不正确",
      422,
    );
  }
  const developmentLocal = isDevelopmentLocalHostname(url.hostname);
  if (isPrivateHostname(url.hostname) && !developmentLocal) {
    throw new DomainError(
      "PRIVATE_EMBED_ORIGIN_REJECTED",
      "允许嵌入的 Origin 不能指向本机或内网",
      422,
    );
  }
  if (url.protocol !== "https:" && !(developmentLocal && url.protocol === "http:")) {
    throw new DomainError(
      "EMBED_ORIGIN_HTTPS_REQUIRED",
      "生产环境的嵌入 Origin 必须使用 HTTPS",
      422,
    );
  }
  if (
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new DomainError(
      "INVALID_EMBED_ORIGIN",
      "Origin 只能包含协议、域名和端口",
      422,
    );
  }
  return url.origin;
}

export function normalizeWebhookUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new DomainError(
      "INVALID_WEBHOOK_URL",
      "Webhook 地址格式不正确",
      422,
    );
  }
  const developmentLocal = isDevelopmentLocalHostname(url.hostname);
  if (isPrivateHostname(url.hostname) && !developmentLocal) {
    throw new DomainError(
      "PRIVATE_WEBHOOK_URL_REJECTED",
      "Webhook 地址不能指向本机或内网",
      422,
    );
  }
  if (url.protocol !== "https:" && !(developmentLocal && url.protocol === "http:")) {
    throw new DomainError(
      "WEBHOOK_HTTPS_REQUIRED",
      "生产环境的 Webhook 必须使用 HTTPS",
      422,
    );
  }
  if (url.username || url.password || url.hash) {
    throw new DomainError(
      "INVALID_WEBHOOK_URL",
      "Webhook 地址不能包含账号或片段",
      422,
    );
  }
  return url.toString();
}
