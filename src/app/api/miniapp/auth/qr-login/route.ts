import { NextResponse } from "next/server";
import { z } from "zod";
import { confirmWebQrLogin } from "@/modules/miniapp/web-qr-login-service";
import {
  requireApiActor,
  routeError,
} from "@/modules/projects/api-utils";

const schema = z.object({
  qrPayload: z.string().trim().min(8).max(200),
});

// 小程序端确认扫码登录：当前 Bearer 用户授权该网页二维码
export async function POST(request: Request) {
  const auth = await requireApiActor();
  if (auth.response) return auth.response;

  try {
    const input = schema.parse(await request.json().catch(() => null));
    const confirmed = await confirmWebQrLogin(auth.actor.id, input.qrPayload);
    if (!confirmed) {
      return NextResponse.json(
        {
          error: {
            code: "QR_TICKET_INVALID",
            message: "二维码无效或已过期，请刷新网页后重新扫码",
          },
        },
        { status: 400 },
      );
    }
    return NextResponse.json({ data: { confirmed: true } });
  } catch (error) {
    return routeError(error, {
      request,
      operation: "miniapp.auth.qr_login",
    });
  }
}
