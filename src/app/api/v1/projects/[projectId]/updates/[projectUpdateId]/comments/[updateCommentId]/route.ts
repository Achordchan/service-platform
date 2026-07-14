import { NextResponse } from "next/server";
import { updateUpdateComment } from "@/modules/projects/project-update-service";
import { updateUpdateCommentSchema } from "@/modules/projects/schemas";
import {
  readJson,
  requireApiActor,
  routeError,
} from "@/modules/projects/api-utils";

type RouteContext = {
  params: Promise<{
    projectId: string;
    projectUpdateId: string;
    updateCommentId: string;
  }>;
};

export async function PATCH(request: Request, context: RouteContext) {
  const auth = await requireApiActor();
  if (auth.response) return auth.response;

  try {
    const { projectId, projectUpdateId, updateCommentId } =
      await context.params;
    const input = updateUpdateCommentSchema.parse(await readJson(request));
    const comment = await updateUpdateComment(
      auth.actor,
      projectId,
      projectUpdateId,
      updateCommentId,
      input,
    );
    return NextResponse.json({ data: comment });
  } catch (error) {
    return routeError(error);
  }
}
