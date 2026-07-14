import { NextResponse } from "next/server";
import {
  createServiceType,
  listServiceTypes,
} from "@/modules/projects/service-type-service";
import { createServiceTypeSchema } from "@/modules/projects/schemas";
import {
  readJson,
  requireApiActor,
  routeError,
} from "@/modules/projects/api-utils";

export async function GET() {
  const auth = await requireApiActor();
  if (auth.response) return auth.response;

  try {
    const serviceTypes = await listServiceTypes(auth.actor);
    return NextResponse.json({ data: serviceTypes });
  } catch (error) {
    return routeError(error);
  }
}

export async function POST(request: Request) {
  const auth = await requireApiActor();
  if (auth.response) return auth.response;

  try {
    const input = createServiceTypeSchema.parse(await readJson(request));
    const serviceType = await createServiceType(auth.actor, input);
    return NextResponse.json({ data: serviceType }, { status: 201 });
  } catch (error) {
    return routeError(error);
  }
}
