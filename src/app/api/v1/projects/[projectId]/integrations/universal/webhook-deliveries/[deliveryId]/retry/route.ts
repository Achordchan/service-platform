import { NextResponse } from "next/server";
import { retryUniversalWebhookDelivery } from "@/modules/integrations/universal/webhook-admin-service";
import { requireApiActor, routeError } from "@/modules/projects/api-utils";

type RouteContext = {
  params: Promise<{ projectId: string; deliveryId: string }>;
};

export async function POST(_request: Request, context: RouteContext) {
  const auth = await requireApiActor();
  if (auth.response) return auth.response;
  try {
    const { projectId, deliveryId } = await context.params;
    return NextResponse.json({
      data: await retryUniversalWebhookDelivery(
        auth.actor,
        projectId,
        deliveryId,
      ),
    });
  } catch (error) {
    return routeError(error);
  }
}
