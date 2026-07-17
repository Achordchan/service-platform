import { updateExternalPresence } from "@/modules/integrations/sub2api/external-presence-service";
import { embedPresenceSchema } from "@/modules/integrations/sub2api/schemas";
import { requireExternalSession } from "@/modules/integrations/sub2api/session-service";
import { readJson, routeError } from "@/modules/projects/api-utils";

type RouteContext = { params: Promise<{ requestId: string }> };

export async function POST(request: Request, context: RouteContext) {
  try {
    const session = await requireExternalSession(request);
    const { requestId } = await context.params;
    const input = embedPresenceSchema.parse(await readJson(request));
    return Response.json({
      data: await updateExternalPresence(session.actor, requestId, input),
    });
  } catch (error) {
    return routeError(error);
  }
}
