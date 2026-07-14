import { NextResponse } from "next/server";
import {
  getPlatformSettings,
  updatePlatformSettings,
} from "@/modules/platform-settings/platform-setting-service";
import { updatePlatformSettingsSchema } from "@/modules/platform-settings/schemas";
import {
  readJson,
  requireApiActor,
  routeError,
} from "@/modules/projects/api-utils";

export async function GET() {
  const auth = await requireApiActor();
  if (auth.response) return auth.response;

  try {
    const settings = await getPlatformSettings(auth.actor);
    return NextResponse.json({ data: settings });
  } catch (error) {
    return routeError(error);
  }
}

export async function PATCH(request: Request) {
  const auth = await requireApiActor();
  if (auth.response) return auth.response;

  try {
    const input = updatePlatformSettingsSchema.parse(await readJson(request));
    const settings = await updatePlatformSettings(auth.actor, input);
    return NextResponse.json({ data: settings });
  } catch (error) {
    return routeError(error);
  }
}
