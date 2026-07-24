import { NextResponse } from "next/server";
import {
  deleteProjectUpdate,
  updateProjectUpdate,
} from "@/modules/projects/project-update-service";
import { updateProjectUpdateSchema } from "@/modules/projects/schemas";
import {
  readJson,
  requireApiActor,
  routeError,
} from "@/modules/projects/api-utils";

type RouteContext = {
  params: Promise<{
    projectId: string;
    projectUpdateId: string;
  }>;
};

export async function PATCH(request: Request, context: RouteContext) {
  const auth = await requireApiActor();
  if (auth.response) return auth.response;

  try {
    const { projectId, projectUpdateId } = await context.params;
    const input = updateProjectUpdateSchema.parse(await readJson(request));
    const update = await updateProjectUpdate(
      auth.actor,
      projectId,
      projectUpdateId,
      input,
    );
    return NextResponse.json({ data: update });
  } catch (error) {
    return routeError(error);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  const auth = await requireApiActor();
  if (auth.response) return auth.response;

  try {
    const { projectId, projectUpdateId } = await context.params;
    const result = await deleteProjectUpdate(
      auth.actor,
      projectId,
      projectUpdateId,
    );
    return NextResponse.json({ data: result });
  } catch (error) {
    return routeError(error, {
      request,
      operation: "project_update.delete",
    });
  }
}
