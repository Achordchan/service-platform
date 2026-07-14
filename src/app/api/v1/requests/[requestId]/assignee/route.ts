import {
  apiErrorResponse,
  requireApiActor,
} from "@/modules/requests/api";
import { assignRequest } from "@/modules/requests/request-command-service";
import { assignRequestSchema } from "@/modules/requests/request-schemas";

type RouteContext = {
  params: Promise<{ requestId: string }>;
};

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const actor = await requireApiActor();
    const { requestId } = await context.params;
    const input = assignRequestSchema.parse(await request.json());
    const serviceRequest = await assignRequest(actor, requestId, input);
    return Response.json({ data: serviceRequest });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
