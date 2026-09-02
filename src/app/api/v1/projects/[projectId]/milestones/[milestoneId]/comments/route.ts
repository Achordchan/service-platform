import { NextResponse } from "next/server";
import {
  createMilestoneComment,
  listMilestoneComments,
} from "@/modules/projects/milestone-comment-service";
import { createMilestoneCommentSchema } from "@/modules/projects/schemas";
import {
  readJson,
  requireApiActor,
  routeError,
} from "@/modules/projects/api-utils";

type RouteContext = {
  params: Promise<{
    projectId: string;
    milestoneId: string;
  }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const auth = await requireApiActor();
  if (auth.response) return auth.response;

  try {
    const { projectId, milestoneId } = await context.params;
    const comments = await listMilestoneComments(
      auth.actor,
      projectId,
      milestoneId,
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
    const { projectId, milestoneId } = await context.params;
    const input = createMilestoneCommentSchema.parse(await readJson(request));
    const comment = await createMilestoneComment(
      auth.actor,
      projectId,
      milestoneId,
      input,
    );
    return NextResponse.json({ data: comment }, { status: 201 });
  } catch (error) {
    return routeError(error);
  }
}
