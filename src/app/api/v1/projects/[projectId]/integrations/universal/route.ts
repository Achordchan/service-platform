import { NextResponse } from "next/server";
import {
  getUniversalIntegration,
  saveUniversalIntegration,
} from "@/modules/integrations/universal/connection-service";
import { universalConnectionSchema } from "@/modules/integrations/universal/schemas";
import {
  readJson,
  requireApiActor,
  routeError,
} from "@/modules/projects/api-utils";

type RouteContext = { params: Promise<{ projectId: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const auth = await requireApiActor();
  if (auth.response) return auth.response;
  try {
    const { projectId } = await context.params;
    return NextResponse.json({
      data: await getUniversalIntegration(auth.actor, projectId),
    });
  } catch (error) {
    return routeError(error);
  }
}

export async function PUT(request: Request, context: RouteContext) {
  const auth = await requireApiActor();
  if (auth.response) return auth.response;
  try {
    const { projectId } = await context.params;
    const input = universalConnectionSchema.parse(await readJson(request));
    return NextResponse.json({
      data: await saveUniversalIntegration(auth.actor, projectId, input),
    });
  } catch (error) {
    return routeError(error);
  }
}
