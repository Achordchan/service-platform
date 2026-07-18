import { getExternalRequest } from "@/modules/integrations/external/request-service";
import { requireExternalSession } from "@/modules/integrations/external/session-service";
import { routeError } from "@/modules/projects/api-utils";

type RouteContext = { params: Promise<{ requestId: string }> };

export async function GET(request: Request, context: RouteContext) {
  try {
    const session = await requireExternalSession(request);
    const { requestId } = await context.params;
    return Response.json({
      data: await getExternalRequest(session.actor, requestId),
    });
  } catch (error) {
    return routeError(error);
  }
}
