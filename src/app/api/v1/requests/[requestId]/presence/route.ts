import {
  apiErrorResponse,
  requireApiActor,
} from "@/modules/requests/api";
import { updateRequestPresence } from "@/modules/requests/request-presence-service";
import { requestPresenceSchema } from "@/modules/requests/request-schemas";

type RouteContext = {
  params: Promise<{ requestId: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  try {
    const actor = await requireApiActor();
    const { requestId } = await context.params;
    const input = requestPresenceSchema.parse(await request.json());
    const result = await updateRequestPresence(actor, requestId, input);
    return Response.json({ data: result });
  } catch (error) {
    return apiErrorResponse(error, {
      request,
      operation: "request.presence.update",
    });
  }
}
