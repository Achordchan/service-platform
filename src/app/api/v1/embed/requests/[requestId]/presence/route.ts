import { updateExternalPresence } from "@/modules/integrations/external/presence-service";
import { embedPresenceSchema } from "@/modules/integrations/sub2api/schemas";
import { requireExternalSession } from "@/modules/integrations/external/session-service";
import { readJson, routeError } from "@/modules/projects/api-utils";

type RouteContext = { params: Promise<{ requestId: string }> };

export async function POST(request: Request, context: RouteContext) {
  try {
    const session = await requireExternalSession(request);
    const { requestId } = await context.params;
    const input = embedPresenceSchema.parse(await readJson(request));
    return Response.json({
      data: await updateExternalPresence(
        session.actor,
        requestId,
        input,
        // 设备信息（IP / UA）记在这个会话上，presence 要存它才连得回去
        session.sessionId,
      ),
    });
  } catch (error) {
    return routeError(error);
  }
}
