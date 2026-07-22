import {
  apiErrorResponse,
  requireApiActor,
} from "@/modules/requests/api";
import { changeRequestArchive } from "@/modules/requests/request-command-service";
import { changeRequestArchiveSchema } from "@/modules/requests/request-schemas";

type RouteContext = {
  params: Promise<{ requestId: string }>;
};

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const actor = await requireApiActor();
    const { requestId } = await context.params;
    const input = changeRequestArchiveSchema.parse(await request.json());
    const serviceRequest = await changeRequestArchive(
      actor,
      requestId,
      input.archived,
    );
    return Response.json({ data: serviceRequest });
  } catch (error) {
    return apiErrorResponse(error, {
      request,
      operation: "request.archive.update",
    });
  }
}
