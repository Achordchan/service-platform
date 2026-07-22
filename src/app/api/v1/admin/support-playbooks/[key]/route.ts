import { NextResponse } from "next/server";
import { readJson, requireApiActor, routeError } from "@/modules/projects/api-utils";
import { updateSupportPlaybookSchema } from "@/modules/requests/support-playbook-schemas";
import {
  deleteSupportPlaybook,
  updateSupportPlaybook,
} from "@/modules/requests/support-playbook-service";

type RouteContext = { params: Promise<{ key: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  const auth = await requireApiActor();
  if (auth.response) return auth.response;
  try {
    const { key } = await context.params;
    const input = updateSupportPlaybookSchema.parse(await readJson(request));
    return NextResponse.json({
      data: await updateSupportPlaybook(auth.actor, key, input),
    });
  } catch (error) {
    return routeError(error);
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  const auth = await requireApiActor();
  if (auth.response) return auth.response;
  try {
    const { key } = await context.params;
    return NextResponse.json({
      data: await deleteSupportPlaybook(auth.actor, key),
    });
  } catch (error) {
    return routeError(error);
  }
}
