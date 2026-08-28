import { NextResponse } from "next/server";
import {
  addProjectStaff,
  listProjectStaff,
} from "@/modules/projects/project-staff-service";
import { addProjectStaffSchema } from "@/modules/projects/schemas";
import {
  readDeliveryOverride,
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
    const staff = await listProjectStaff(auth.actor, projectId);
    return NextResponse.json({ data: staff });
  } catch (error) {
    return routeError(error);
  }
}

export async function POST(request: Request, context: RouteContext) {
  const auth = await requireApiActor();
  if (auth.response) return auth.response;

  try {
    const { projectId } = await context.params;
    const body = await readJson(request);
    const input = addProjectStaffSchema.parse(body);
    const staff = await addProjectStaff(
      auth.actor,
      projectId,
      input,
      readDeliveryOverride(body),
    );
    return NextResponse.json({ data: staff }, { status: 201 });
  } catch (error) {
    return routeError(error);
  }
}
