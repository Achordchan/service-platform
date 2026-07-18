import { NextResponse } from "next/server";
import { listUniversalWebhookDeliveries } from "@/modules/integrations/universal/webhook-admin-service";
import { requireApiActor, routeError } from "@/modules/projects/api-utils";

type RouteContext = { params: Promise<{ projectId: string }> };

export async function GET(request: Request, context: RouteContext) {
  const auth = await requireApiActor();
  if (auth.response) return auth.response;
  try {
    const { projectId } = await context.params;
    const limit = Number(new URL(request.url).searchParams.get("limit") ?? 50);
    return NextResponse.json({
      data: await listUniversalWebhookDeliveries(
        auth.actor,
        projectId,
        Number.isFinite(limit) ? limit : 50,
      ),
    });
  } catch (error) {
    return routeError(error);
  }
}
