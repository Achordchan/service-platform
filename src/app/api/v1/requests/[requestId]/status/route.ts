import {
  apiErrorResponse,
  requireApiActor,
} from "@/modules/requests/api";
import { changeRequestStatus } from "@/modules/requests/request-command-service";
import { changeRequestStatusSchema } from "@/modules/requests/request-schemas";

type RouteContext = {
  params: Promise<{ requestId: string }>;
};

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const actor = await requireApiActor();
    const { requestId } = await context.params;
    const input = changeRequestStatusSchema.parse(await request.json());
    const serviceRequest = await changeRequestStatus(
      actor,
      requestId,
      input.status,
    );
    return Response.json({ data: serviceRequest });
  } catch (error) {
    return apiErrorResponse(error, {
      request,
      operation: "request.status.update",
    });
  }
}
