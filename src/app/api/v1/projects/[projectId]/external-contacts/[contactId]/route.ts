import { NextResponse } from "next/server";
import { updateExternalContact } from "@/modules/integrations/sub2api/connection-service";
import { externalContactPatchSchema } from "@/modules/integrations/sub2api/schemas";
import {
  readJson,
  requireApiActor,
  routeError,
} from "@/modules/projects/api-utils";

type RouteContext = {
  params: Promise<{ projectId: string; contactId: string }>;
};

export async function PATCH(request: Request, context: RouteContext) {
  const auth = await requireApiActor();
  if (auth.response) return auth.response;
  try {
    const { projectId, contactId } = await context.params;
    const input = externalContactPatchSchema.parse(await readJson(request));
    return NextResponse.json({
      data: await updateExternalContact(
        auth.actor,
        projectId,
        contactId,
        input,
      ),
    });
  } catch (error) {
    return routeError(error);
  }
}
