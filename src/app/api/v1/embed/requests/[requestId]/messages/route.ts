import { addExternalRequestMessage } from "@/modules/integrations/sub2api/external-request-service";
import { embedMessageSchema } from "@/modules/integrations/sub2api/schemas";
import { requireExternalSession } from "@/modules/integrations/sub2api/session-service";
import { readJson, routeError } from "@/modules/projects/api-utils";

type RouteContext = { params: Promise<{ requestId: string }> };

export async function POST(request: Request, context: RouteContext) {
  try {
    const session = await requireExternalSession(request);
    const { requestId } = await context.params;
    const input = embedMessageSchema.parse(await readJson(request));
    return Response.json(
      {
        data: await addExternalRequestMessage(session.actor, requestId, input, {
          customerMemberNotificationsEnabled:
            session.connection.customerMemberNotificationsEnabled,
        }),
      },
      { status: 201 },
    );
  } catch (error) {
    return routeError(error);
  }
}
