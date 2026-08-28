import {
  apiErrorResponse,
  requireApiActor,
} from "@/modules/requests/api";
import { updateRequestPresence } from "@/modules/requests/request-presence-service";
import { requestPresenceSchema } from "@/modules/requests/request-schemas";
import { clientIpFromHeaders } from "@/lib/request-network";

type RouteContext = {
  params: Promise<{ requestId: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  try {
    const actor = await requireApiActor();
    const { requestId } = await context.params;
    const input = requestPresenceSchema.parse(await request.json());
    // UA 与 IP 一律从请求头取，不采信客户端自报的值
    const result = await updateRequestPresence(actor, requestId, input, {
      ipAddress: clientIpFromHeaders(request.headers),
      userAgent: request.headers.get("user-agent"),
    });
    return Response.json({ data: result });
  } catch (error) {
    return apiErrorResponse(error, {
      request,
      operation: "request.presence.update",
    });
  }
}
