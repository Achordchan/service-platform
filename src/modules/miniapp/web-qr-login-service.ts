import "server-only";

import { createHmac, randomBytes } from "node:crypto";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { env } from "@/lib/runtime-env";
// 网页版扫码登录（已绑定小程序微信的用户快速登录 Web），唯一通道为小程序码：
//   Web 登录页 → POST 创建票据 → img 加载小程序码（wxacode.getUnlimited, scene=t:<token>）
//   微信扫一扫/长按 → 直达小程序 pages/web-login 确认页 → Bearer 身份确认（CONFIRMED + userId）
//   Web 登录页 → 轮询发现 CONFIRMED → 服务端代签 better-auth session cookie 并消费票据
//
// 会话签发：直接落 Session 表并按 better-auth 的 cookie 格式签名
// （value = encodeURIComponent(`${token}.${base64(hmacSHA256(secret, token))}`)，
//  与 better-call crypto.signCookieValue 逐字一致），集成测试会真实回放验证。

export const QR_TTL_MS = 5 * 60 * 1000;
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

// 票据与创建它的浏览器绑定（防登录 CSRF/会话置换）：POST 创建时签发
// HttpOnly cookie，票据侧只存 HMAC 哈希；轮询与小程序码请求必须携带匹配值
export const QR_BIND_COOKIE_NAME = "webqr_bind";

/** 从请求 Cookie 头解析绑定 cookie（两个 web-login 路由共用） */
export function readQrBindCookie(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === QR_BIND_COOKIE_NAME) return decodeURIComponent(rest.join("="));
  }
  return null;
}

function hashBindSecret(secret: string) {
  return createHmac("sha256", env.BETTER_AUTH_SECRET)
    .update(`webqrbind:${secret}`)
    .digest("hex");
}

function hashToken(token: string) {
  return createHmac("sha256", env.BETTER_AUTH_SECRET)
    .update(`webqr:${token}`)
    .digest("hex");
}

export function createQrToken() {
  // 26 字符（192bit 熵）：满足小程序码 scene ≤32 字符的限制
  const token = `qr_${randomBytes(19).toString("base64url")}`;
  return { token, tokenHash: hashToken(token) };
}

export async function createWebQrLoginTicket() {
  const { token, tokenHash } = createQrToken();
  const bindSecret = randomBytes(16).toString("base64url");
  const ticket = await prisma.webQrLoginTicket.create({
    data: {
      tokenHash,
      bindHash: hashBindSecret(bindSecret),
      expiresAt: new Date(Date.now() + QR_TTL_MS),
    },
    select: { id: true, expiresAt: true },
  });
  return {
    ticketId: ticket.id,
    token,
    expiresAt: ticket.expiresAt,
    bindSecret,
  };
}

export type QrLoginStatus =
  | { status: "PENDING"; expiresAt: Date }
  | { status: "EXPIRED" }
  | { status: "CONFIRMED"; consumed: false }
  | { status: "LOGGED_IN"; consumed: true };

export type ConsumeResult =
  | { outcome: "pending"; expiresAt: Date }
  | { outcome: "expired" }
  | { outcome: "ready"; userId: string }
  // already：票据已被消费（重叠轮询/响应丢失）。携带 userId 与消费时间，
  // 调用方在短窗口内可重新代签会话——否则「前端显示成功但浏览器没拿到 cookie」
  | { outcome: "already"; userId: string; consumedAt: Date };

/** Web 轮询：CONFIRMED 时原子消费并返回待签发的用户。
 * bindSecret 来自创建票据时下发的 HttpOnly cookie；票据带 bindHash 时必须匹配，
 * 否则视为无效（防登录 CSRF：他人浏览器无法凭 URL 里的 ticketId+token 完成交换）。 */
export async function consumeConfirmedTicket(
  ticketId: string,
  qrPayloadToken: string,
  bindSecret?: string | null,
): Promise<ConsumeResult> {
  const ticket = await prisma.webQrLoginTicket.findUnique({
    where: { id: ticketId },
    select: {
      id: true,
      tokenHash: true,
      status: true,
      userId: true,
      expiresAt: true,
      consumedAt: true,
      bindHash: true,
    },
  });
  if (!ticket) return { outcome: "expired" };
  if (ticket.tokenHash !== hashToken(qrPayloadToken)) {
    return { outcome: "expired" };
  }
  if (ticket.bindHash !== null) {
    const bound =
      Boolean(bindSecret) && hashBindSecret(bindSecret!) === ticket.bindHash;
    if (!bound) return { outcome: "expired" };
  }
  if (ticket.status === "CONSUMED") {
    if (ticket.userId && ticket.consumedAt) {
      return {
        outcome: "already",
        userId: ticket.userId,
        consumedAt: ticket.consumedAt,
      };
    }
    return { outcome: "expired" };
  }
  if (ticket.status !== "CONFIRMED") {
    if (ticket.expiresAt.getTime() <= Date.now()) {
      return { outcome: "expired" };
    }
    return { outcome: "pending", expiresAt: ticket.expiresAt };
  }
  const consumed = await prisma.webQrLoginTicket.updateMany({
    where: { id: ticket.id, status: "CONFIRMED" },
    data: { status: "CONSUMED", consumedAt: new Date() },
  });
  if (consumed.count === 0) {
    // 并发轮询被另一请求抢先：按 already 处理（需回读消费方信息）
    const reread = await prisma.webQrLoginTicket.findUnique({
      where: { id: ticket.id },
      select: { userId: true, consumedAt: true },
    });
    if (reread?.userId && reread.consumedAt) {
      return {
        outcome: "already",
        userId: reread.userId,
        consumedAt: reread.consumedAt,
      };
    }
    return { outcome: "expired" };
  }
  return { outcome: "ready", userId: ticket.userId! };
}

/**
 * 已消费票据的一次性重签声明：轮询响应丢失/重叠轮询时最多补签一次，
 * 原子占用 reissuedAt 防止脚本化轮询在窗口内批量铸造 Session。
 * 校验同 consumeConfirmedTicket（token + 浏览器绑定双因子）。
 */
export async function claimSingleReissue(
  ticketId: string,
  qrPayloadToken: string,
  bindSecret?: string | null,
): Promise<{ userId: string } | null> {
  const ticket = await prisma.webQrLoginTicket.findUnique({
    where: { id: ticketId },
    select: { tokenHash: true, bindHash: true, userId: true },
  });
  if (!ticket?.userId) return null;
  if (ticket.tokenHash !== hashToken(qrPayloadToken)) return null;
  if (ticket.bindHash !== null) {
    const bound =
      Boolean(bindSecret) && hashBindSecret(bindSecret!) === ticket.bindHash;
    if (!bound) return null;
  }
  const claimed = await prisma.webQrLoginTicket.updateMany({
    where: { id: ticketId, reissuedAt: null },
    data: { reissuedAt: new Date() },
  });
  return claimed.count > 0 ? { userId: ticket.userId } : null;
}

// 唯一进入形态：小程序确认页携带的 t:<token>（来自小程序码 scene）
function extractQrToken(qrPayload: string): string {
  const trimmed = qrPayload.trim();
  if (trimmed.startsWith("t:")) {
    return trimmed.slice(2).trim();
  }
  return trimmed;
}

/** 小程序确认：当前 Bearer 用户授权该二维码登录网页版 */
export async function confirmWebQrLogin(userId: string, qrPayload: string) {
  const token = extractQrToken(qrPayload);
  if (!token || token.length < 16) return false;
  const claimed = await prisma.webQrLoginTicket.updateMany({
    where: {
      tokenHash: hashToken(token),
      status: "PENDING",
      expiresAt: { gt: new Date() },
    },
    data: { status: "CONFIRMED", userId, confirmedAt: new Date() },
  });
  return claimed.count > 0;
}

/** 为已确认用户创建 better-auth 会话并返回 cookie（代签，格式与 better-auth 一致） */
export async function issueWebQrSession(userId: string) {
  const token = randomBytes(32).toString("base64url");
  await prisma.session.create({
    data: {
      token,
      userId,
      expiresAt: new Date(Date.now() + SESSION_TTL_SECONDS * 1000),
    },
  });
  const signature = createHmac("sha256", env.BETTER_AUTH_SECRET)
    .update(token)
    .digest("base64");
  const cookieValue = encodeURIComponent(`${token}.${signature}`);

  // Cookie 名/属性必须取 better-auth 实例的权威定义：baseURL 为 https 时
  // better-auth 读写的是 __Secure-better-auth.session_token（且要求 Secure）。
  // 手拼固定名会在生产 HTTPS 下「写得进、读不到」，扫码登录静默失效。
  const context = (await auth.$context) as {
    authCookies: {
      sessionToken: {
        name: string;
        attributes: {
          maxAge?: number;
          path?: string;
          httpOnly?: boolean;
          sameSite?: string;
          secure?: boolean;
          domain?: string;
        };
      };
    };
  };
  const { name, attributes } = context.authCookies.sessionToken;
  const parts = [`${name}=${cookieValue}`];
  parts.push(`Max-Age=${attributes.maxAge ?? SESSION_TTL_SECONDS}`);
  parts.push(`Path=${attributes.path ?? "/"}`);
  if (attributes.httpOnly !== false) parts.push("HttpOnly");
  if (attributes.sameSite) {
    const value = attributes.sameSite.toLowerCase();
    parts.push(`SameSite=${value.charAt(0).toUpperCase()}${value.slice(1)}`);
  }
  if (attributes.secure) parts.push("Secure");
  if (attributes.domain) parts.push(`Domain=${attributes.domain}`);
  return { cookie: parts.join("; "), cookieName: name };
}

/** 兜底清理入口（由 miniapp identity sweep 复用调用亦可） */
export function webQrTicketWhereExpired() {
  return {
    OR: [
      { status: "PENDING", expiresAt: { lt: new Date() } },
      { status: "CONFIRMED", expiresAt: { lt: new Date() } },
    ],
  } as const;
}
