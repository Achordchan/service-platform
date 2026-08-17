import { NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  claimSingleReissue,
  consumeConfirmedTicket,
  issueWebQrSession,
  readQrBindCookie,
} from "@/modules/miniapp/web-qr-login-service";

export const dynamic = "force-dynamic";

// 登录页轮询：PENDING 继续等；CONFIRMED 一次性消费并代签 better-auth cookie。
// 限流按 ticketId 计：ticketId+token 本身就是不可猜的能力凭证，轮自己的票据
// 不构成滥用——按 IP 计会在企业 NAT 下（约 4 个并发扫码会话）互相挤兑，
// 429 静默导致二维码「永远不亮」。60/min 上限仍可拦对单票据的脚本轰击。
// 票据消费/补签均要求绑定 cookie（POST 创建时签发，防登录 CSRF）；
// already = 票据刚被重叠轮询/响应丢失的请求消费：一次性补签（原子声明），不可重复。
export async function GET(
  request: Request,
  context: { params: Promise<{ ticketId: string }> },
) {
  const { ticketId } = await context.params;
  if (!checkRateLimit(`web-login:qr:poll:${ticketId}`, 60, 60_000)) {
    return NextResponse.json(
      { error: { code: "RATE_LIMITED", message: "请求过于频繁" } },
      { status: 429 },
    );
  }
  const token = new URL(request.url).searchParams.get("token") ?? "";
  const bindSecret = readQrBindCookie(request.headers.get("cookie"));
  const result = await consumeConfirmedTicket(ticketId, token, bindSecret);
  if (result.outcome === "ready") {
    const { cookie } = await issueWebQrSession(result.userId);
    return NextResponse.json(
      { data: { status: "LOGGED_IN" } },
      { headers: { "set-cookie": cookie } },
    );
  }
  if (result.outcome === "already") {
    const claim = await claimSingleReissue(ticketId, token, bindSecret);
    if (!claim) {
      return NextResponse.json({ data: { status: "EXPIRED" } });
    }
    const { cookie } = await issueWebQrSession(claim.userId);
    return NextResponse.json(
      { data: { status: "LOGGED_IN" } },
      { headers: { "set-cookie": cookie } },
    );
  }
  if (result.outcome === "pending") {
    return NextResponse.json({
      data: { status: "PENDING", expiresAt: result.expiresAt },
    });
  }
  return NextResponse.json({ data: { status: "EXPIRED" } });
}

