import { NextResponse } from "next/server";
import { createUniversalCredentialForProject } from "@/modules/integrations/universal/connection-service";
import { requireApiActor, routeError } from "@/modules/projects/api-utils";

type RouteContext = { params: Promise<{ projectId: string }> };

export async function POST(_request: Request, context: RouteContext) {
  const auth = await requireApiActor();
  if (auth.response) return auth.response;
  try {
    const { projectId } = await context.params;
    return NextResponse.json(
      {
        data: await createUniversalCredentialForProject(
          auth.actor,
          projectId,
        ),
      },
      { status: 201 },
    );
  } catch (error) {
    return routeError(error);
  }
}
