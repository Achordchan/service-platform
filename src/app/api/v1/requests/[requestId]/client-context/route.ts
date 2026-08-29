import {
  apiErrorResponse,
  requireApiActor,
} from "@/modules/requests/api";
import { listRequestClientContexts } from "@/modules/requests/request-presence-service";

type RouteContext = {
  params: Promise<{ requestId: string }>;
};

// 客户的设备 / 时区 / IP 归属地：仅后台人员可读（服务层再断言一次）。
// 常驻的「客户在线」标识旁不显示这些，这里是按需查看的入口。
export async function GET(request: Request, context: RouteContext) {
  try {
    const actor = await requireApiActor();
    const { requestId } = await context.params;
    const data = await listRequestClientContexts(actor, requestId);
    return Response.json({ data });
  } catch (error) {
    return apiErrorResponse(error, {
      request,
      operation: "request.client_context.list",
    });
  }
}
