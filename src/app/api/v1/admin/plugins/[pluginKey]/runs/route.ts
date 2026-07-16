import { NextResponse } from "next/server";
import {
  requireApiActor,
  routeError,
} from "@/modules/projects/api-utils";
import { startPluginHistoryRun } from "@/modules/plugins/plugin-service";

export async function POST(
  _request: Request,
  context: { params: Promise<{ pluginKey: string }> },
) {
  const auth = await requireApiActor();
  if (auth.response) return auth.response;
  try {
    const { pluginKey } = await context.params;
    const run = await startPluginHistoryRun(auth.actor, pluginKey);
    return NextResponse.json({ data: run }, { status: 201 });
  } catch (error) {
    return routeError(error);
  }
}
