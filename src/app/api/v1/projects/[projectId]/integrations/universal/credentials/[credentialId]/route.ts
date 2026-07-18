import { NextResponse } from "next/server";
import { revokeUniversalCredential } from "@/modules/integrations/universal/connection-service";
import { requireApiActor, routeError } from "@/modules/projects/api-utils";

type RouteContext = {
  params: Promise<{ projectId: string; credentialId: string }>;
};

export async function DELETE(_request: Request, context: RouteContext) {
  const auth = await requireApiActor();
  if (auth.response) return auth.response;
  try {
    const { projectId, credentialId } = await context.params;
    return NextResponse.json({
      data: await revokeUniversalCredential(
        auth.actor,
        projectId,
        credentialId,
      ),
    });
  } catch (error) {
    return routeError(error);
  }
}
