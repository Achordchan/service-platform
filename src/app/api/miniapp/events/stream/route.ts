import { createEventStreamResponse } from "@/modules/notifications/event-stream-handler";
import {
  requireApiActor,
  routeError,
} from "@/modules/projects/api-utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 小程序实时事件流：与 Web SSE 完全同一实现（LISTEN 唤醒 + EventRecord 游标回放），
// 仅认证入口不同——统一 requireApiActor（Bearer 优先）。小程序端用
// wx.request enableChunked 分块解析 text/event-stream。
export async function GET(request: Request) {
  const auth = await requireApiActor();
  if (auth.response) return auth.response;
  try {
    return createEventStreamResponse(auth.actor, request);
  } catch (error) {
    return routeError(error, {
      request,
      operation: "miniapp.events.stream",
    });
  }
}
