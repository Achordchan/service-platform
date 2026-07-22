import { NextResponse } from "next/server";
import { updateProjectStage } from "@/modules/projects/project-stage-service";
import { updateProjectStageSchema } from "@/modules/projects/schemas";
import {
  readJson,
  requireApiActor,
  routeError,
} from "@/modules/projects/api-utils";

type RouteContext = {
  params: Promise<{ projectId: string }>;
};

export async function PATCH(request: Request, context: RouteContext) {
  const auth = await requireApiActor();
  if (auth.response) return auth.response;

  try {
    const { projectId } = await context.params;
    const input = updateProjectStageSchema.parse(await readJson(request));
    const project = await updateProjectStage(auth.actor, projectId, input);
    return NextResponse.json({ data: project });
  } catch (error) {
    return routeError(error);
  }
}
