import { NextResponse } from "next/server";
import { z } from "zod";
import {
  isWechatTemplateKey,
  listSubscribeGrants,
  reportSubscribeGrant,
} from "@/modules/miniapp/wechat-subscribe-message-service";
import {
  requireApiActor,
  routeError,
} from "@/modules/projects/api-utils";

const grantReportSchema = z.object({
  templateKey: z.string().trim().min(1).max(40),
  accept: z.literal(true),
});

// 当前用户各订阅模板剩余额度：小程序展示真实订阅状态与顶部引导横幅的检测源。
export async function GET(request: Request) {
  const auth = await requireApiActor();
  if (auth.response) return auth.response;

  try {
    const grants = await listSubscribeGrants(auth.actor.id);
    return NextResponse.json({ data: { grants } });
  } catch (error) {
    return routeError(error, {
      request,
      operation: "miniapp.subscribe_message.grants.list",
    });
  }
}

export async function POST(request: Request) {
  const auth = await requireApiActor();
  if (auth.response) return auth.response;

  try {
    const input = grantReportSchema.parse(
      await request.json().catch(() => null),
    );
    if (!isWechatTemplateKey(input.templateKey)) {
      return NextResponse.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "未知的订阅消息模板",
          },
        },
        { status: 422 },
      );
    }
    // 客户端授权上报只作为额度状态：服务端节流/封顶，真实额度按微信发送结果修正
    const data = await reportSubscribeGrant(auth.actor.id, input.templateKey);
    return NextResponse.json({ data });
  } catch (error) {
    return routeError(error, {
      request,
      operation: "miniapp.subscribe_message.grants",
    });
  }
}
