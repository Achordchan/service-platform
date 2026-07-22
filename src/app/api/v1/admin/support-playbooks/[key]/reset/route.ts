import { NextResponse } from "next/server";
import { requireApiActor, routeError } from "@/modules/projects/api-utils";
import { resetSupportPlaybook } from "@/modules/requests/support-playbook-service";

type RouteContext = { params: Promise<{ key: string }> };

export async function POST(_request: Request, context: RouteContext) {
  const auth = await requireApiActor();
  if (auth.response) return auth.response;
  try {
    const { key } = await context.params;
    return NextResponse.json({
      data: await resetSupportPlaybook(auth.actor, key),
    });
  } catch (error) {
    return routeError(error);
  }
}
