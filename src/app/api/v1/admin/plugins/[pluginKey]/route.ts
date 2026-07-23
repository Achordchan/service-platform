import { NextResponse } from "next/server";
import { z } from "zod";
import { updatePluginInstallation } from "@/modules/plugins/plugin-service";
import {
  readJson,
  requireApiActor,
  routeError,
} from "@/modules/projects/api-utils";

const schema = z
  .object({
    enabled: z.boolean().optional(),
    config: z.record(z.string(), z.unknown()).optional(),
    secrets: z.record(z.string(), z.unknown()).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "至少提交一个插件配置",
  });

export async function PATCH(
  request: Request,
  context: { params: Promise<{ pluginKey: string }> },
) {
  const auth = await requireApiActor();
  if (auth.response) return auth.response;
  try {
    const { pluginKey } = await context.params;
    const input = schema.parse(
      await readJson(request, { maxBytes: 64 * 1024 }),
    );
    const plugin = await updatePluginInstallation(
      auth.actor,
      pluginKey,
      input,
    );
    return NextResponse.json({ data: plugin });
  } catch (error) {
    return routeError(error);
  }
}
