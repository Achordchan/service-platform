import { NextResponse } from "next/server";
import { listUpdateCommentRevisions } from "@/modules/projects/project-update-service";
import {
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

export async function GET(request: Request, context: RouteContext) {
  const auth = await requireApiActor();
  if (auth.response) return auth.response;

  try {
    const { projectId, projectUpdateId, updateCommentId } =
      await context.params;
    const revisions = await listUpdateCommentRevisions(
      auth.actor,
      projectId,
      projectUpdateId,
      updateCommentId,
    );
    return NextResponse.json({ data: revisions });
  } catch (error) {
    return routeError(error, {
      request,
      operation: "update_comment_revision.list",
    });
  }
}
