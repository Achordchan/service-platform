import { NextResponse } from "next/server";
import { z } from "zod";
import {
  readJson,
  requireApiActor,
  routeError,
} from "@/modules/projects/api-utils";
import { sendPluginTestMessage } from "@/modules/plugins/plugin-test-message-service";

const schema = z
  .object({
    eventType: z
      .enum(["REQUEST_CREATED", "REQUEST_CUSTOMER_REPLIED"])
      .optional(),
    template: z
      .object({
        title: z.string().trim().min(1).max(80),
        body: z.string().trim().min(1).max(2_000),
      })
      .strict()
      .optional(),
  })
  .strict()
  .refine((value) => !value.template || value.eventType, {
    message: "模板测试必须指定事件类型",
  });

export async function POST(
  request: Request,
  context: { params: Promise<{ pluginKey: string }> },
) {
  const auth = await requireApiActor();
  if (auth.response) return auth.response;
  try {
    const { pluginKey } = await context.params;
    const body = await readJson(request, { maxBytes: 16 * 1024 });
    const input = schema.parse(body);
    const result = await sendPluginTestMessage(auth.actor, pluginKey, input);
    return NextResponse.json({ data: result });
  } catch (error) {
    return routeError(error, {
      operation: "plugin.test_message",
    });
  }
}
