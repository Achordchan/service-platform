import { NextResponse } from "next/server";
import {
  recordResendWebhook,
  verifyResendWebhook,
} from "@/modules/platform-settings/resend-webhook-service";
import { DomainError } from "@/modules/projects/errors";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const id = request.headers.get("svix-id");
  const timestamp = request.headers.get("svix-timestamp");
  const signature = request.headers.get("svix-signature");
  if (!id || !timestamp || !signature) {
    return NextResponse.json(
      { error: { code: "INVALID_WEBHOOK", message: "Webhook 签名头缺失" } },
      { status: 400 },
    );
  }

  const rawBody = await request.text();
  let event: Awaited<ReturnType<typeof verifyResendWebhook>>;
  try {
    event = await verifyResendWebhook({
      payload: rawBody,
      id,
      timestamp,
      signature,
    });
  } catch (error) {
    if (
      error instanceof DomainError &&
      error.code === "RESEND_WEBHOOK_NOT_CONFIGURED"
    ) {
      return NextResponse.json(
        { error: { code: error.code, message: error.message } },
        { status: error.status },
      );
    }
    return NextResponse.json(
      { error: { code: "INVALID_WEBHOOK", message: "Webhook 验证失败" } },
      { status: 400 },
    );
  }

  try {
    const result = await recordResendWebhook(id, event);
    return NextResponse.json({ data: result });
  } catch (error) {
    console.error("Resend webhook processing failed", error);
    return NextResponse.json(
      { error: { code: "WEBHOOK_PROCESSING_FAILED", message: "Webhook 处理失败" } },
      { status: 500 },
    );
  }
}
