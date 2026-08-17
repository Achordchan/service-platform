import { NextResponse } from "next/server";
import { removeCustomerSpaceMember } from "@/modules/customer-spaces/customer-member-service";
import {
  requireApiActor,
  routeError,
} from "@/modules/projects/api-utils";

type RouteContext = {
  params: Promise<{ membershipId: string }>;
};

export async function DELETE(request: Request, context: RouteContext) {
  const auth = await requireApiActor();
  if (auth.response) return auth.response;

  try {
    const { membershipId } = await context.params;
    const spaceId = new URL(request.url).searchParams.get("spaceId");
    if (!spaceId) {
      return NextResponse.json(
        { error: { code: "VALIDATION_ERROR", message: "缺少 spaceId" } },
        { status: 422 },
      );
    }
    await removeCustomerSpaceMember(auth.actor, spaceId, membershipId);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return routeError(error, {
      request,
      operation: "miniapp.space.members.remove",
    });
  }
}
