import { z } from "zod";
import {
  apiErrorResponse,
  requireApiActor,
} from "@/modules/requests/api";
import { listRequestsForActor } from "@/modules/requests/request-service";

const listRequestsQuerySchema = z.object({
  projectId: z.string().trim().min(1).optional(),
  status: z
    .enum(["PENDING", "IN_PROGRESS", "WAITING_CUSTOMER", "RESOLVED", "CLOSED"])
    .optional(),
  q: z.string().trim().max(120).optional(),
  priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).optional(),
  archived: z.enum(["EXCLUDE", "ONLY", "ALL"]).optional(),
  assignedToMe: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export async function GET(request: Request) {
  try {
    const actor = await requireApiActor();
    const url = new URL(request.url);
    const filters = listRequestsQuerySchema.parse({
      projectId: url.searchParams.get("projectId") ?? undefined,
      status: url.searchParams.get("status") ?? undefined,
      q: url.searchParams.get("q") ?? undefined,
      priority: url.searchParams.get("priority") ?? undefined,
      archived: url.searchParams.get("archived") ?? undefined,
      assignedToMe: url.searchParams.get("assignedToMe") ?? undefined,
      limit: url.searchParams.get("limit") ?? undefined,
      offset: url.searchParams.get("offset") ?? undefined,
    });
    const data = await listRequestsForActor(actor, filters);
    return Response.json({ data });
  } catch (error) {
    return apiErrorResponse(error, {
      request,
      operation: "requests.list_for_actor",
    });
  }
}
