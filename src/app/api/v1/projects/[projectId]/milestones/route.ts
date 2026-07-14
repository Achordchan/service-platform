import { NextResponse } from "next/server";
import {
  createMilestone,
  listMilestones,
} from "@/modules/projects/milestone-service";
import { createMilestoneSchema } from "@/modules/projects/schemas";
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
    const result = await listMilestones(auth.actor, projectId);
    return NextResponse.json({ data: result });
  } catch (error) {
    return routeError(error);
  }
}

export async function POST(request: Request, context: RouteContext) {
  const auth = await requireApiActor();
  if (auth.response) return auth.response;

  try {
    const { projectId } = await context.params;
    const input = createMilestoneSchema.parse(await readJson(request));
    const milestone = await createMilestone(auth.actor, projectId, input);
    return NextResponse.json({ data: milestone }, { status: 201 });
  } catch (error) {
    return routeError(error);
  }
}
