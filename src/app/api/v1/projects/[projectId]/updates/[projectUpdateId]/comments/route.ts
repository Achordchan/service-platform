import { NextResponse } from "next/server";
import {
  createUpdateComment,
  listUpdateComments,
} from "@/modules/projects/project-update-service";
import { createUpdateCommentSchema } from "@/modules/projects/schemas";
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

export async function GET(_request: Request, context: RouteContext) {
  const auth = await requireApiActor();
  if (auth.response) return auth.response;

  try {
    const { projectId, projectUpdateId } = await context.params;
    const comments = await listUpdateComments(
      auth.actor,
      projectId,
      projectUpdateId,
    );
    return NextResponse.json({ data: comments });
  } catch (error) {
    return routeError(error);
  }
}

export async function POST(request: Request, context: RouteContext) {
  const auth = await requireApiActor();
  if (auth.response) return auth.response;

  try {
    const { projectId, projectUpdateId } = await context.params;
    const input = createUpdateCommentSchema.parse(await readJson(request));
    const comment = await createUpdateComment(
      auth.actor,
      projectId,
      projectUpdateId,
      input,
    );
    return NextResponse.json({ data: comment }, { status: 201 });
  } catch (error) {
    return routeError(error);
  }
}
