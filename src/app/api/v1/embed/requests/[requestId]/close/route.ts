import { confirmExternalRequestClosed } from "@/modules/integrations/sub2api/external-request-service";
import { requireExternalSession } from "@/modules/integrations/sub2api/session-service";
import { routeError } from "@/modules/projects/api-utils";

type RouteContext = { params: Promise<{ requestId: string }> };

export async function POST(request: Request, context: RouteContext) {
  try {
    const session = await requireExternalSession(request);
    const { requestId } = await context.params;
    return Response.json({
      data: await confirmExternalRequestClosed(session.actor, requestId),
    });
  } catch (error) {
    return routeError(error);
  }
}
