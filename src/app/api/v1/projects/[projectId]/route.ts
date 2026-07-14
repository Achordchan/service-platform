import { NextResponse } from "next/server";
import {
  getProject,
  updateProject,
} from "@/modules/projects/project-service";
import { updateProjectSchema } from "@/modules/projects/schemas";
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
    const project = await getProject(auth.actor, projectId);
    return NextResponse.json({ data: project });
  } catch (error) {
    return routeError(error);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  const auth = await requireApiActor();
  if (auth.response) return auth.response;

  try {
    const { projectId } = await context.params;
    const input = updateProjectSchema.parse(await readJson(request));
    const project = await updateProject(auth.actor, projectId, input);
    return NextResponse.json({ data: project });
  } catch (error) {
    return routeError(error);
  }
}
