import { embedCreateRequestSchema } from "@/modules/integrations/sub2api/schemas";
import {
  createExternalRequest,
  listExternalRequests,
} from "@/modules/integrations/sub2api/external-request-service";
import { requireExternalSession } from "@/modules/integrations/sub2api/session-service";
import { readJson, routeError } from "@/modules/projects/api-utils";

export async function GET(request: Request) {
  try {
    const session = await requireExternalSession(request);
    return Response.json({ data: await listExternalRequests(session.actor) });
  } catch (error) {
    return routeError(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireExternalSession(request);
    const input = embedCreateRequestSchema.parse(await readJson(request));
    return Response.json(
      {
        data: await createExternalRequest(session.actor, input, {
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
