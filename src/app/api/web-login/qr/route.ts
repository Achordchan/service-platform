import { NextResponse } from "next/server";
import { checkRateLimit, clientIpFromRequest } from "@/lib/rate-limit";
import { env } from "@/lib/runtime-env";
import {
  createWebQrLoginTicket,
  QR_BIND_COOKIE_NAME,
  QR_TTL_MS,
} from "@/modules/miniapp/web-qr-login-service";

export const dynamic = "force-dynamic";

// 公开端点：登录页创建扫码票据（随机 token 不可猜，5 分钟有效）。
// 每次创建都会连带一次小程序码生成（消耗微信 API 配额），按 IP 限流防刷。
// 同时签发 HttpOnly 绑定 cookie：票据只能被创建它的浏览器消费（防登录 CSRF）。
export async function POST(request: Request) {
  const ip = clientIpFromRequest(request);
  if (!checkRateLimit(`web-login:qr:create:${ip}`, 6, 60_000)) {
    return NextResponse.json(
      { error: { code: "RATE_LIMITED", message: "请求过于频繁，请稍后再试" } },
      { status: 429 },
    );
  }
  const data = await createWebQrLoginTicket();
  const maxAge = Math.ceil(QR_TTL_MS / 1000);
  // 绑定 cookie 是认证交换凭据：生产 HTTPS 下必须带 Secure，
  // 与 better-auth 的 __Secure- 前缀判定同源（BETTER_AUTH_URL 协议）
  const secure =
    new URL(env.BETTER_AUTH_URL).protocol === "https:" ? "; Secure" : "";
  return NextResponse.json(
    { data: { ticketId: data.ticketId, token: data.token, expiresAt: data.expiresAt } },
    {
      status: 201,
      headers: {
        "set-cookie": `${QR_BIND_COOKIE_NAME}=${data.bindSecret}; Path=/api/web-login; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`,
      },
    },
  );
}
