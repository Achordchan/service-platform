import { NextResponse } from "next/server";
import { miniappBindOtpSendSchema } from "@/modules/miniapp/schemas";
import { sendBindingOtp } from "@/modules/miniapp/wechat-binding-service";
import { readJson, routeError } from "@/modules/projects/api-utils";

export async function POST(request: Request) {
  try {
    const input = miniappBindOtpSendSchema.parse(
      await readJson(request, { maxBytes: 8 * 1024 }),
    );
    const result = await sendBindingOtp(input);
    return NextResponse.json({ data: result });
  } catch (error) {
    return routeError(error, {
      request,
      operation: "miniapp.auth.bind.otp.send",
    });
  }
}
