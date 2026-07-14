import { NextResponse } from "next/server";
import { removeCustomerSpaceMember } from "@/modules/customer-spaces/customer-member-service";
import {
  requireApiActor,
  routeError,
} from "@/modules/projects/api-utils";

type RouteContext = {
  params: Promise<{
    customerSpaceId: string;
    membershipId: string;
  }>;
};

export async function DELETE(_request: Request, context: RouteContext) {
  const auth = await requireApiActor();
  if (auth.response) return auth.response;

  try {
    const { customerSpaceId, membershipId } = await context.params;
    await removeCustomerSpaceMember(
      auth.actor,
      customerSpaceId,
      membershipId,
    );
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return routeError(error);
  }
}
