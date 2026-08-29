import {
  apiErrorResponse,
  requireApiActor,
} from "@/modules/requests/api";
import { addRequestMessage } from "@/modules/requests/request-command-service";
import {
  clientMutationKeySchema,
  createRequestMessageSchema,
} from "@/modules/requests/request-schemas";
import { readDeliveryOverride } from "@/modules/projects/api-utils";

type RouteContext = {
  params: Promise<{ requestId: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  try {
    const actor = await requireApiActor();
    const { requestId } = await context.params;
    const body = await request.json();
    const input = createRequestMessageSchema.parse(body);
    const mutationKey = clientMutationKeySchema.optional().nullable()
      .parse(request.headers.get("x-idempotency-key")) ?? undefined;
    const result = await addRequestMessage(
      actor,
      requestId,
      { ...input, clientMutationKey: input.clientMutationKey ?? mutationKey },
      readDeliveryOverride(actor, body),
    );
    return Response.json({ data: result }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error, {
      request,
      operation: "request_message.create",
    });
  }
}
