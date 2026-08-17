import { NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/rate-limit";
import { getWxaCodeUnlimitedBuffer } from "@/modules/miniapp/wechat-api-client";
import {
  consumeConfirmedTicket,
  readQrBindCookie,
} from "@/modules/miniapp/web-qr-login-service";

export const dynamic = "force-dynamic";

// 小程序码图片：Web 登录页 <img> 直接加载（ticket+token+绑定 cookie 三因子校验）。
// 个人主体无法用「扫普通链接二维码」规则，但小程序码个人可用（需小程序已发布）。
// 不可用（dev/未配置/未发布）时返回 503，前端降级为占位说明。
// 限流按 ticketId 计（与轮询端一致）：票据三因子不可猜，刷票据须先过创建端点
// 的 6/min IP 限；按 IP 计会在企业 NAT 下把第 21 个打开登录页的用户挤成 429，
// 二维码降级成占位、无法扫码。单票据 20/min 足够覆盖 img 加载与网络重试。
export async function GET(
  request: Request,
  context: { params: Promise<{ ticketId: string }> },
) {
  const { ticketId } = await context.params;
  if (!checkRateLimit(`web-login:qr:wxacode:${ticketId}`, 20, 60_000)) {
    return NextResponse.json(
      { error: { code: "RATE_LIMITED", message: "请求过于频繁，请稍后再试" } },
      { status: 429 },
    );
  }
  const token = new URL(request.url).searchParams.get("token") ?? "";
  const bindSecret = readQrBindCookie(request.headers.get("cookie"));
  // 复用票据校验：token 匹配、来自创建票据的浏览器、仍在等待确认
  const ticket = await consumeConfirmedTicket(ticketId, token, bindSecret);
  if (ticket.outcome !== "pending") {
    return NextResponse.json(
      { error: { code: "QR_TICKET_INVALID", message: "二维码无效或已过期" } },
      { status: 400 },
    );
  }
  try {
    const image = await getWxaCodeUnlimitedBuffer(`t=${token}`);
    return new NextResponse(image as unknown as BodyInit, {
      headers: {
        "content-type": "image/png",
        "cache-control": "private, no-store",
      },
    });
  } catch {
    return NextResponse.json(
      {
        error: {
          code: "WXA_CODE_UNAVAILABLE",
          message: "小程序码暂不可用",
        },
      },
      { status: 503 },
    );
  }
}

