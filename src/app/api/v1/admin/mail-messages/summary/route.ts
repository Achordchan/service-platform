import { NextResponse } from "next/server";
import { getMailOutboxSummary } from "@/modules/platform-settings/platform-setting-service";
import {
  requireApiActor,
  routeError,
} from "@/modules/projects/api-utils";

export async function GET() {
  const auth = await requireApiActor();
  if (auth.response) return auth.response;

  try {
    return NextResponse.json({
      data: await getMailOutboxSummary(auth.actor),
    });
  } catch (error) {
    return routeError(error);
  }
}
