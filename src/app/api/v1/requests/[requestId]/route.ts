import {
  apiErrorResponse,
  requireApiActor,
} from "@/modules/requests/api";
import { getRequest } from "@/modules/requests/request-service";

type RouteContext = {
  params: Promise<{ requestId: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  try {
    const actor = await requireApiActor();
    const { requestId } = await context.params;
    const serviceRequest = await getRequest(actor, requestId);
    return Response.json({ data: serviceRequest });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
