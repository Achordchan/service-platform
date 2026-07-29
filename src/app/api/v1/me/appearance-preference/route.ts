import { NextResponse } from "next/server";
import {
  appearancePreferenceSchema,
  getAppearancePreference,
  updateAppearancePreference,
} from "@/modules/users/appearance-preference-service";
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
      data: await getAppearancePreference(auth.actor),
    });
  } catch (error) {
    return routeError(error);
  }
}

export async function PATCH(request: Request) {
  const auth = await requireApiActor();
  if (auth.response) return auth.response;
  try {
    const input = appearancePreferenceSchema.parse(
      await readJson(request, { maxBytes: 4 * 1024 }),
    );
    return NextResponse.json({
      data: await updateAppearancePreference(auth.actor, input),
    });
  } catch (error) {
    return routeError(error);
  }
}
