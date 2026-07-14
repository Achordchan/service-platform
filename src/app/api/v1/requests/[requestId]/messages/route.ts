import {
  apiErrorResponse,
  requireApiActor,
} from "@/modules/requests/api";
import { addRequestMessage } from "@/modules/requests/request-command-service";
import { createRequestMessageSchema } from "@/modules/requests/request-schemas";

type RouteContext = {
  params: Promise<{ requestId: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  try {
    const actor = await requireApiActor();
    const { requestId } = await context.params;
    const input = createRequestMessageSchema.parse(await request.json());
    const result = await addRequestMessage(actor, requestId, input);
    return Response.json({ data: result }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
