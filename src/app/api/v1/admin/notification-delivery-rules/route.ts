import { NextResponse } from "next/server";
import {
  listNotificationDeliveryRules,
  updateNotificationDeliveryRules,
} from "@/modules/notifications/notification-delivery-rule-service";
import { readJson, requireApiActor, routeError } from "@/modules/projects/api-utils";

export async function GET() {
  const auth = await requireApiActor();
  if (auth.response) return auth.response;
  try {
    return NextResponse.json({ data: await listNotificationDeliveryRules(auth.actor) });
  } catch (error) {
    return routeError(error);
  }
}

export async function PUT(request: Request) {
  const auth = await requireApiActor();
  if (auth.response) return auth.response;
  try {
    return NextResponse.json({
      data: await updateNotificationDeliveryRules(auth.actor, await readJson(request)),
    });
  } catch (error) {
    return routeError(error);
  }
}
