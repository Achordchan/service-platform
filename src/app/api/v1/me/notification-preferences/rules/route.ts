import { NextResponse } from "next/server";
import {
  perTypePreferenceSchema,
  updatePerTypePreference,
} from "@/modules/users/notification-preference-service";
import {
  readJson,
  requireApiActor,
  routeError,
} from "@/modules/projects/api-utils";

export async function PUT(request: Request) {
  const auth = await requireApiActor();
  if (auth.response) return auth.response;
  try {
    const input = perTypePreferenceSchema.parse(await readJson(request));
    return NextResponse.json({
      data: await updatePerTypePreference(auth.actor, input),
    });
  } catch (error) {
    return routeError(error);
  }
}
