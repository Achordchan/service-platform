import {
  apiErrorResponse,
  requireApiActor,
} from "@/modules/requests/api";
import {
  createRequest,
  listProjectRequests,
} from "@/modules/requests/request-service";
import { createRequestSchema } from "@/modules/requests/request-schemas";

type RouteContext = {
  params: Promise<{ projectId: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  try {
    const actor = await requireApiActor();
    const { projectId } = await context.params;
    const requests = await listProjectRequests(actor, projectId);
    return Response.json({ data: requests });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const actor = await requireApiActor();
    const { projectId } = await context.params;
    const input = createRequestSchema.parse(await request.json());
    const created = await createRequest(actor, projectId, input);
    return Response.json({ data: created }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
