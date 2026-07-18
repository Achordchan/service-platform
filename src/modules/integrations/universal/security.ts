import {
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { DomainError } from "@/modules/projects/errors";

export function hashUniversalSecret(value: string) {
  return createHash("sha256").update(value).digest("base64url");
}

export function verifyUniversalSecret(value: string, expectedHash: string) {
  const actual = Buffer.from(hashUniversalSecret(value));
  const expected = Buffer.from(expectedHash);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function createUniversalCredential() {
  const clientId = `ac_${randomBytes(18).toString("base64url")}`;
  const clientSecret = `acs_${randomBytes(32).toString("base64url")}`;
  return {
    clientId,
    clientSecret,
    secretHash: hashUniversalSecret(clientSecret),
    secretPrefix: clientSecret.slice(0, 12),
  };
}

export function createUniversalTicket() {
  const ticket = `act_${randomBytes(32).toString("base64url")}`;
  return { ticket, ticketHash: hashUniversalSecret(ticket) };
}

export function createUniversalWebhookSecret() {
  return `whsec_${randomBytes(32).toString("base64url")}`;
}

export function parseUniversalBasicAuth(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  const match = /^Basic\s+([^\s]+)$/i.exec(authorization);
  if (!match) {
    throw new DomainError(
      "UNIVERSAL_CREDENTIAL_REQUIRED",
      "缺少 Achord Connect 凭据",
      401,
    );
  }
  let decoded = "";
  try {
    decoded = Buffer.from(match[1], "base64").toString("utf8");
  } catch {
    throw new DomainError(
      "UNIVERSAL_CREDENTIAL_INVALID",
      "Achord Connect 凭据无效",
      401,
    );
  }
  const separator = decoded.indexOf(":");
  if (separator <= 0) {
    throw new DomainError(
      "UNIVERSAL_CREDENTIAL_INVALID",
      "Achord Connect 凭据无效",
      401,
    );
  }
  return {
    clientId: decoded.slice(0, separator),
    clientSecret: decoded.slice(separator + 1),
  };
}
