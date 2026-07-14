import { NextResponse } from "next/server";
import {
  getServiceType,
  updateServiceType,
} from "@/modules/projects/service-type-service";
import { updateServiceTypeSchema } from "@/modules/projects/schemas";
import {
  readJson,
  requireApiActor,
  routeError,
} from "@/modules/projects/api-utils";

type RouteContext = {
  params: Promise<{ serviceTypeId: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const auth = await requireApiActor();
  if (auth.response) return auth.response;

  try {
    const { serviceTypeId } = await context.params;
    const serviceType = await getServiceType(auth.actor, serviceTypeId);
    return NextResponse.json({ data: serviceType });
  } catch (error) {
    return routeError(error);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  const auth = await requireApiActor();
  if (auth.response) return auth.response;

  try {
    const { serviceTypeId } = await context.params;
    const input = updateServiceTypeSchema.parse(await readJson(request));
    const serviceType = await updateServiceType(
      auth.actor,
      serviceTypeId,
      input,
    );
    return NextResponse.json({ data: serviceType });
  } catch (error) {
    return routeError(error);
  }
}
