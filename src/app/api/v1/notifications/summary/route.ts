import { NextResponse } from "next/server";
import { getNotificationSummary } from "@/modules/notifications/notification-service";
import {
  requireApiActor,
  routeError,
} from "@/modules/projects/api-utils";

export async function GET(request: Request) {
  const auth = await requireApiActor();
  if (auth.response) return auth.response;
  try {
    return NextResponse.json({ data: await getNotificationSummary(auth.actor) });
  } catch (error) {
    return routeError(error, { request, operation: "notifications.summary" });
  }
}
