import { NextResponse } from "next/server";
import {
  removeProjectStaff,
  updateProjectStaff,
} from "@/modules/projects/project-staff-service";
import { updateProjectStaffSchema } from "@/modules/projects/schemas";
import {
  readDeliveryOverride,
  readJson,
  readOptionalJson,
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
    const body = await readJson(request);
    const input = updateProjectStaffSchema.parse(body);
    const staff = await updateProjectStaff(
      auth.actor,
      projectId,
      projectStaffId,
      input,
      readDeliveryOverride(auth.actor, body),
    );
    return NextResponse.json({ data: staff });
  } catch (error) {
    return routeError(error);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  const auth = await requireApiActor();
  if (auth.response) return auth.response;

  try {
    const { projectId, projectStaffId } = await context.params;
    // 移出也会给当事人发通知，所以同样接收本次操作的提醒方式覆盖；
    // DELETE 不强制带 body，空体按「不覆盖」处理。
    const body = await readOptionalJson(request);
    await removeProjectStaff(
      auth.actor,
      projectId,
      projectStaffId,
      readDeliveryOverride(auth.actor, body),
    );
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return routeError(error);
  }
}
