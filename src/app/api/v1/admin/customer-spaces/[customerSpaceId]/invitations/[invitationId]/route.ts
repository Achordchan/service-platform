import { NextResponse } from "next/server";
import { revokeCustomerSpaceInvitation } from "@/modules/customer-spaces/customer-member-service";
import {
  requireApiActor,
  routeError,
} from "@/modules/projects/api-utils";

type RouteContext = {
  params: Promise<{
    customerSpaceId: string;
    invitationId: string;
  }>;
};

export async function DELETE(request: Request, context: RouteContext) {
  const auth = await requireApiActor();
  if (auth.response) return auth.response;

  try {
    const { customerSpaceId, invitationId } = await context.params;
    await revokeCustomerSpaceInvitation(
      auth.actor,
      customerSpaceId,
      invitationId,
    );
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return routeError(error, {
      request,
      operation: "customer_space.invitation.revoke",
    });
  }
}
