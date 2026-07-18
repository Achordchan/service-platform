import { NextResponse } from "next/server";
import { listExternalContacts } from "@/modules/integrations/external/contact-service";
import { externalContactListQuerySchema } from "@/modules/integrations/external/schemas";
import { requireApiActor, routeError } from "@/modules/projects/api-utils";

type RouteContext = { params: Promise<{ projectId: string }> };

export async function GET(request: Request, context: RouteContext) {
  const auth = await requireApiActor();
  if (auth.response) return auth.response;
  try {
    const { projectId } = await context.params;
    const params = new URL(request.url).searchParams;
    const input = externalContactListQuerySchema.parse({
      keyword: params.get("q") || undefined,
      status: params.get("status") || undefined,
      cursor: params.get("cursor") || undefined,
      limit: params.get("limit") || undefined,
    });
    return NextResponse.json({
      data: await listExternalContacts(auth.actor, projectId, input),
    });
  } catch (error) {
    return routeError(error);
  }
}
