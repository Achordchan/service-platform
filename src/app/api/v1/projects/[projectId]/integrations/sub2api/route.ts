import { NextResponse } from "next/server";
import {
  getSub2ApiIntegration,
  saveSub2ApiIntegration,
} from "@/modules/integrations/sub2api/connection-service";
import {
  sub2ApiConnectionPatchSchema,
  sub2ApiConnectionSchema,
} from "@/modules/integrations/sub2api/schemas";
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
      data: await getSub2ApiIntegration(auth.actor, projectId),
    });
  } catch (error) {
    return routeError(error);
  }
}

export async function POST(request: Request, context: RouteContext) {
  const auth = await requireApiActor();
  if (auth.response) return auth.response;
  try {
    const { projectId } = await context.params;
    const input = sub2ApiConnectionSchema.parse(await readJson(request));
    return NextResponse.json(
      { data: await saveSub2ApiIntegration(auth.actor, projectId, input) },
      { status: 201 },
    );
  } catch (error) {
    return routeError(error);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  const auth = await requireApiActor();
  if (auth.response) return auth.response;
  try {
    const { projectId } = await context.params;
    const input = sub2ApiConnectionPatchSchema.parse(await readJson(request));
    return NextResponse.json({
      data: await saveSub2ApiIntegration(auth.actor, projectId, input),
    });
  } catch (error) {
    return routeError(error);
  }
}
