import { NextResponse } from "next/server";
import {
  templateIdFor,
  WECHAT_SUBSCRIBE_TEMPLATES,
} from "@/modules/miniapp/wechat-subscribe-message-service";
import {
  requireApiActor,
  routeError,
} from "@/modules/projects/api-utils";

// 模板 ID 唯一配置源是服务端 env；小程序授权引导从这里拉取，
// 运维配置正式模板后无需发版小程序。
export async function GET(request: Request) {
  const auth = await requireApiActor();
  if (auth.response) return auth.response;

  try {
    const templates = WECHAT_SUBSCRIBE_TEMPLATES.map((template) => ({
      templateKey: template.templateKey,
      templateId: templateIdFor(template.templateKey),
    })).filter((template) => Boolean(template.templateId));
    return NextResponse.json({ data: { templates } });
  } catch (error) {
    return routeError(error, {
      request,
      operation: "miniapp.subscribe_message.config",
    });
  }
}
