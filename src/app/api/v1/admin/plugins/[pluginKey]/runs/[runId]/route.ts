import { NextResponse } from "next/server";
import { z } from "zod";
import {
  readJson,
  requireApiActor,
  routeError,
} from "@/modules/projects/api-utils";
import { controlPluginRun } from "@/modules/plugins/plugin-service";

const schema = z.object({
  action: z.enum(["pause", "resume", "cancel"]),
});

export async function PATCH(
  request: Request,
  context: {
    params: Promise<{ pluginKey: string; runId: string }>;
  },
) {
  const auth = await requireApiActor();
  if (auth.response) return auth.response;
  try {
    const { pluginKey, runId } = await context.params;
    const input = schema.parse(await readJson(request));
    const run = await controlPluginRun(
      auth.actor,
      pluginKey,
      runId,
      input.action,
    );
    return NextResponse.json({ data: run });
  } catch (error) {
    return routeError(error);
  }
}
