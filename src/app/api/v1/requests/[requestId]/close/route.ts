import {
  apiErrorResponse,
  requireApiActor,
} from "@/modules/requests/api";
import { confirmRequestClosed } from "@/modules/requests/request-command-service";

type RouteContext = {
  params: Promise<{ requestId: string }>;
};

export async function POST(_request: Request, context: RouteContext) {
  try {
    const actor = await requireApiActor();
    const { requestId } = await context.params;
    const serviceRequest = await confirmRequestClosed(actor, requestId);
    return Response.json({ data: serviceRequest });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
