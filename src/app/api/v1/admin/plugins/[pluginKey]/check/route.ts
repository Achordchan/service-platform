import { NextResponse } from "next/server";
import {
  requireApiActor,
  routeError,
} from "@/modules/projects/api-utils";
import { runPluginHealthCheck } from "@/modules/plugins/plugin-service";

export async function POST(
  _request: Request,
  context: { params: Promise<{ pluginKey: string }> },
) {
  const auth = await requireApiActor();
  if (auth.response) return auth.response;
  try {
    const { pluginKey } = await context.params;
    const result = await runPluginHealthCheck(auth.actor, pluginKey);
    return NextResponse.json({ data: result });
  } catch (error) {
    return routeError(error);
  }
}
