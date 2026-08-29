import { NextResponse } from "next/server";
import { checkRateLimit, clientIpFromRequest } from "@/lib/rate-limit";
import { clientIpFromHeaders } from "@/lib/request-network";
import { revokeMiniappSessionByAuthorization } from "@/modules/miniapp/session";
import { miniappLoginSchema } from "@/modules/miniapp/schemas";
import { createMiniappSessionForCode } from "@/modules/miniapp/wechat-binding-service";
import { readJson, routeError } from "@/modules/projects/api-utils";

export async function POST(request: Request) {
  try {
    // 公开端点且每次调用都消耗一次微信 code2Session 配额，按 IP 限流防匿名刷
    const ip = clientIpFromRequest(request);
    if (!checkRateLimit(`miniapp:auth:session:${ip}`, 10, 60_000)) {
      return NextResponse.json(
        { error: { code: "RATE_LIMITED", message: "请求过于频繁，请稍后再试" } },
        { status: 429 },
      );
    }
    const input = miniappLoginSchema.parse(
      await readJson(request, { maxBytes: 8 * 1024 }),
    );
    // 第二参保持默认微信 provider；第三参为登录审计的可信来源信息
    const result = await createMiniappSessionForCode(input, undefined, {
      ipAddress: clientIpFromHeaders(request.headers),
      userAgent: request.headers.get("user-agent"),
    });
    if (result.status === "SESSION_ISSUED") {
      return NextResponse.json({
        data: {
          status: result.status,
          token: result.token,
          expiresAt: result.expiresAt,
        },
      });
    }
    return NextResponse.json({
      data: {
        status: result.status,
        bindingTicket: result.bindingTicket,
        ticketExpiresAt: result.ticketExpiresAt,
      },
    });
  } catch (error) {
    return routeError(error, { request, operation: "miniapp.auth.session" });
  }
}

export async function DELETE(request: Request) {
  try {
    const revoked = await revokeMiniappSessionByAuthorization(
      request.headers.get("authorization"),
    );
    // 重复登出也返回成功，客户端统一清理本地状态
    return NextResponse.json({ data: { revoked } });
  } catch (error) {
    return routeError(error, { request, operation: "miniapp.auth.logout" });
  }
}
