import { NextResponse } from "next/server";
import {
  removeProjectStaff,
  updateProjectStaff,
} from "@/modules/projects/project-staff-service";
import { updateProjectStaffSchema } from "@/modules/projects/schemas";
import {
  readJson,
  requireApiActor,
  routeError,
} from "@/modules/projects/api-utils";

type RouteContext = {
  params: Promise<{
    projectId: string;
    projectStaffId: string;
  }>;
};

export async function PATCH(request: Request, context: RouteContext) {
  const auth = await requireApiActor();
  if (auth.response) return auth.response;

  try {
    const { projectId, projectStaffId } = await context.params;
    const input = updateProjectStaffSchema.parse(await readJson(request));
    const staff = await updateProjectStaff(
      auth.actor,
      projectId,
      projectStaffId,
      input,
    );
    return NextResponse.json({ data: staff });
  } catch (error) {
    return routeError(error);
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  const auth = await requireApiActor();
  if (auth.response) return auth.response;

  try {
    const { projectId, projectStaffId } = await context.params;
    await removeProjectStaff(auth.actor, projectId, projectStaffId);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return routeError(error);
  }
}
