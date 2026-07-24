import { z } from "zod";
import {
  apiErrorResponse,
  requireApiActor,
} from "@/modules/requests/api";
import { revokeRequestMessageByAdmin } from "@/modules/plugins/content-risk-review-service";

const revokeMessageSchema = z.object({
  reason: z.string().trim().min(2).max(200),
});

type RouteContext = {
  params: Promise<{ requestId: string; messageId: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  try {
    const actor = await requireApiActor();
    const { requestId, messageId } = await context.params;
    const input = revokeMessageSchema.parse(await request.json());
    const result = await revokeRequestMessageByAdmin(
      actor,
      requestId,
      messageId,
      input.reason,
    );
    return Response.json({ data: result });
  } catch (error) {
    return apiErrorResponse(error, {
      request,
      operation: "request_message.revoke",
    });
  }
}
