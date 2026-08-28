import {
  apiErrorResponse,
  requireApiActor,
} from "@/modules/requests/api";
import { changeRequestStatus } from "@/modules/requests/request-command-service";
import { changeRequestStatusSchema } from "@/modules/requests/request-schemas";
import { readDeliveryOverride } from "@/modules/projects/api-utils";

type RouteContext = {
  params: Promise<{ requestId: string }>;
};

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const actor = await requireApiActor();
    const { requestId } = await context.params;
    const body = await request.json();
    const input = changeRequestStatusSchema.parse(body);
    const serviceRequest = await changeRequestStatus(
      actor,
      requestId,
      input.status,
      readDeliveryOverride(actor, body),
    );
    return Response.json({ data: serviceRequest });
  } catch (error) {
    return apiErrorResponse(error, {
      request,
      operation: "request.status.update",
    });
  }
}
