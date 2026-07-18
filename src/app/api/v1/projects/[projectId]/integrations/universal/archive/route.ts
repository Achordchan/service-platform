import { NextResponse } from "next/server";
import { archiveUniversalIntegration } from "@/modules/integrations/universal/connection-service";
import { requireApiActor, routeError } from "@/modules/projects/api-utils";

type RouteContext = { params: Promise<{ projectId: string }> };

export async function POST(_request: Request, context: RouteContext) {
  const auth = await requireApiActor();
  if (auth.response) return auth.response;
  try {
    const { projectId } = await context.params;
    return NextResponse.json({
      data: await archiveUniversalIntegration(auth.actor, projectId),
    });
  } catch (error) {
    return routeError(error);
  }
}
