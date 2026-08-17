import { NextResponse } from "next/server";
import { listProjectUpdateRevisions } from "@/modules/projects/project-update-service";
import {
  requireApiActor,
  routeError,
} from "@/modules/projects/api-utils";

type RouteContext = {
  params: Promise<{
    projectId: string;
    projectUpdateId: string;
  }>;
};

export async function GET(request: Request, context: RouteContext) {
  const auth = await requireApiActor();
  if (auth.response) return auth.response;

  try {
    const { projectId, projectUpdateId } = await context.params;
    const revisions = await listProjectUpdateRevisions(
      auth.actor,
      projectId,
      projectUpdateId,
    );
    return NextResponse.json({ data: revisions });
  } catch (error) {
    return routeError(error, {
      request,
      operation: "project_update_revision.list",
    });
  }
}
