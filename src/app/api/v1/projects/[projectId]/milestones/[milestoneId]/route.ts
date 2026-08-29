import { NextResponse } from "next/server";
import {
  deleteMilestone,
  updateMilestone,
} from "@/modules/projects/milestone-service";
import { updateMilestoneSchema } from "@/modules/projects/schemas";
import {
  readDeliveryOverride,
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

export async function PATCH(request: Request, context: RouteContext) {
  const auth = await requireApiActor();
  if (auth.response) return auth.response;

  try {
    const { projectId, milestoneId } = await context.params;
    const body = await readJson(request);
    const input = updateMilestoneSchema.parse(body);
    const milestone = await updateMilestone(
      auth.actor,
      projectId,
      milestoneId,
      input,
      readDeliveryOverride(auth.actor, body),
    );
    return NextResponse.json({ data: milestone });
  } catch (error) {
    return routeError(error);
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  const auth = await requireApiActor();
  if (auth.response) return auth.response;

  try {
    const { projectId, milestoneId } = await context.params;
    await deleteMilestone(auth.actor, projectId, milestoneId);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return routeError(error);
  }
}
