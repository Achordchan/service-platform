import { embedCreateRequestSchema } from "@/modules/integrations/external/schemas";
import {
  createExternalRequest,
  listExternalRequests,
} from "@/modules/integrations/external/request-service";
import { requireExternalSession } from "@/modules/integrations/external/session-service";
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
