import { NextResponse } from "next/server";
import {
  getNotificationPreferences,
  notificationPreferenceSchema,
  updateNotificationPreferences,
} from "@/modules/users/notification-preference-service";
import {
  readJson,
  requireApiActor,
  routeError,
} from "@/modules/projects/api-utils";

export async function GET() {
  const auth = await requireApiActor();
  if (auth.response) return auth.response;
  try {
    return NextResponse.json({
      data: await getNotificationPreferences(auth.actor),
    });
  } catch (error) {
    return routeError(error);
  }
}

export async function PATCH(request: Request) {
  const auth = await requireApiActor();
  if (auth.response) return auth.response;
  try {
    const input = notificationPreferenceSchema.parse(await readJson(request));
    return NextResponse.json({
      data: await updateNotificationPreferences(auth.actor, input),
    });
  } catch (error) {
    return routeError(error);
  }
}
