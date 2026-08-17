import { requireUserWithAccess } from "@/lib/session";
import { createEventStreamResponse } from "@/modules/notifications/event-stream-handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { actor } = await requireUserWithAccess();
  return createEventStreamResponse(actor, request);
}
