import { NextResponse } from "next/server";
import { getProjectProgress } from "@/modules/projects/milestone-service";
import {
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
    const progress = await getProjectProgress(auth.actor, projectId);
    return NextResponse.json({ data: progress });
  } catch (error) {
    return routeError(error);
  }
}
