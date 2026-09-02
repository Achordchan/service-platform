import { NextResponse } from "next/server";
import {
  deleteMilestoneComment,
  updateMilestoneComment,
} from "@/modules/projects/milestone-comment-service";
import { updateMilestoneCommentSchema } from "@/modules/projects/schemas";
import {
  readJson,
  requireApiActor,
  routeError,
} from "@/modules/projects/api-utils";

type RouteContext = {
  params: Promise<{
    projectId: string;
    milestoneId: string;
    milestoneCommentId: string;
  }>;
};

export async function PATCH(request: Request, context: RouteContext) {
  const auth = await requireApiActor();
  if (auth.response) return auth.response;

  try {
    const { projectId, milestoneId, milestoneCommentId } =
      await context.params;
    const input = updateMilestoneCommentSchema.parse(await readJson(request));
    const comment = await updateMilestoneComment(
      auth.actor,
      projectId,
      milestoneId,
      milestoneCommentId,
      input,
    );
    return NextResponse.json({ data: comment });
  } catch (error) {
    return routeError(error);
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  const auth = await requireApiActor();
  if (auth.response) return auth.response;

  try {
    const { projectId, milestoneId, milestoneCommentId } =
      await context.params;
    const result = await deleteMilestoneComment(
      auth.actor,
      projectId,
      milestoneId,
      milestoneCommentId,
    );
    return NextResponse.json({ data: result });
  } catch (error) {
    return routeError(error);
  }
}
