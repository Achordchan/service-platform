import { createHash, randomBytes, randomInt } from "node:crypto";

// 32 字符字母表（剔除 0/O/1/I 避免混淆），8 位 ≈ 40 bit 熵
const BINDING_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const BINDING_CODE_LENGTH = 8;

export const BINDING_CODE_TTL_MS = 15 * 60 * 1000;
export const MINIAPP_AUTH_TICKET_TTL_MS = 10 * 60 * 1000;
export const MINIAPP_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function createBindingCode() {
  let raw = "";
  for (let i = 0; i < BINDING_CODE_LENGTH; i += 1) {
    raw += BINDING_CODE_ALPHABET[randomInt(BINDING_CODE_ALPHABET.length)];
  }
  const code = `${raw.slice(0, 4)}-${raw.slice(4)}`;
  return {
    code,
    codeHash: hashBindingCode(code),
    expiresAt: new Date(Date.now() + BINDING_CODE_TTL_MS),
  };
}

export function normalizeBindingCode(input: string) {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function hashBindingCode(code: string) {
  return createHash("sha256")
    .update(normalizeBindingCode(code))
    .digest("hex");
}

export function createMiniappSessionToken() {
  const token = `ma_${randomBytes(32).toString("base64url")}`;
  return {
    token,
    tokenHash: hashSecretToken(token),
    expiresAt: new Date(Date.now() + MINIAPP_SESSION_TTL_MS),
  };
}

export function createAuthTicket() {
  const ticket = `mt_${randomBytes(32).toString("base64url")}`;
  return {
    ticket,
    ticketHash: hashSecretToken(ticket),
    expiresAt: new Date(Date.now() + MINIAPP_AUTH_TICKET_TTL_MS),
  };
}

export function hashSecretToken(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function maskOpenid(openid: string) {
  if (openid.length <= 8) return "****";
  return `${openid.slice(0, 4)}***${openid.slice(-3)}`;
}
