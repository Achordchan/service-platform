import "server-only";

import { createHmac, hkdfSync, timingSafeEqual } from "node:crypto";
import { env } from "@/lib/runtime-env";

// Native Launch 门户在宿主 App 里点附件时，宿主会把新窗口交给系统浏览器，
// 系统浏览器既拿不到 sessionStorage 里的会话，也带不了 Authorization 头。
// 这里签一个绑定「会话 + 附件」的短期链接；兑现时仍按会话现状重新鉴权。
export const EMBED_ATTACHMENT_LINK_TTL_MS = 60_000;

function signingKey() {
  return Buffer.from(
    hkdfSync(
      "sha256",
      env.BETTER_AUTH_SECRET,
      "service-platform-embed",
      "attachment-download-link",
      32,
    ),
  );
}

function signature(sessionId: string, attachmentId: string, expiresAt: number) {
  return createHmac("sha256", signingKey())
    .update(`${sessionId}\n${attachmentId}\n${expiresAt}`)
    .digest("base64url");
}

export function createEmbedAttachmentDownloadToken(
  sessionId: string,
  attachmentId: string,
  now = Date.now(),
) {
  const expiresAt = now + EMBED_ATTACHMENT_LINK_TTL_MS;
  const encodedSession = Buffer.from(sessionId).toString("base64url");
  return {
    token: `${encodedSession}.${expiresAt}.${signature(sessionId, attachmentId, expiresAt)}`,
    expiresAt: new Date(expiresAt),
  };
}

/** 验签通过且未过期时返回会话 id，否则返回 null */
export function verifyEmbedAttachmentDownloadToken(
  token: string,
  attachmentId: string,
  now = Date.now(),
) {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [encodedSession, rawExpiresAt, actual] = parts;
  const expiresAt = Number(rawExpiresAt);
  if (!/^\d{1,15}$/.test(rawExpiresAt) || expiresAt <= now) return null;
  const sessionId = Buffer.from(encodedSession, "base64url").toString("utf8");
  if (!sessionId) return null;
  const expected = Buffer.from(signature(sessionId, attachmentId, expiresAt));
  const received = Buffer.from(actual);
  if (
    expected.length !== received.length ||
    !timingSafeEqual(expected, received)
  ) {
    return null;
  }
  return sessionId;
}
