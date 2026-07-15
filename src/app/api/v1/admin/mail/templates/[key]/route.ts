import { NextResponse } from "next/server";
import {
  resetMailTemplate,
  updateMailTemplate,
} from "@/modules/platform-settings/mail-template-service";
import { updateMailTemplateSchema } from "@/modules/platform-settings/schemas";
import {
  readJson,
  requireApiActor,
  routeError,
} from "@/modules/projects/api-utils";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ key: string }> },
) {
  const auth = await requireApiActor();
  if (auth.response) return auth.response;

  try {
    const { key } = await context.params;
    const input = updateMailTemplateSchema.parse(await readJson(request));
    const templates = await updateMailTemplate(auth.actor, key, input);
    return NextResponse.json({ data: templates });
  } catch (error) {
    return routeError(error);
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ key: string }> },
) {
  const auth = await requireApiActor();
  if (auth.response) return auth.response;

  try {
    const { key } = await context.params;
    const templates = await resetMailTemplate(auth.actor, key);
    return NextResponse.json({ data: templates });
  } catch (error) {
    return routeError(error);
  }
}
