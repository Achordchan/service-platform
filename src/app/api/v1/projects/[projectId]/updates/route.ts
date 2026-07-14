import { NextResponse } from "next/server";
import {
  createProjectUpdate,
  listProjectUpdates,
} from "@/modules/projects/project-update-service";
import { createProjectUpdateSchema } from "@/modules/projects/schemas";
import {
  readJson,
  requireApiActor,
  routeError,
} from "@/modules/projects/api-utils";

type RouteContext = {
  params: Promise<{ projectId: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const auth = await requireApiActor();
  if (auth.response) return auth.response;

  try {
    const { projectId } = await context.params;
    const updates = await listProjectUpdates(auth.actor, projectId);
    return NextResponse.json({ data: updates });
  } catch (error) {
    return routeError(error);
  }
}

export async function POST(request: Request, context: RouteContext) {
  const auth = await requireApiActor();
  if (auth.response) return auth.response;

  try {
    const { projectId } = await context.params;
    const input = createProjectUpdateSchema.parse(await readJson(request));
    const update = await createProjectUpdate(auth.actor, projectId, input);
    return NextResponse.json({ data: update }, { status: 201 });
  } catch (error) {
    return routeError(error);
  }
}
