import { NextResponse } from "next/server";
import {
  requireApiActor,
  routeError,
} from "@/modules/projects/api-utils";
import { revokeStaffInvitation } from "@/modules/users/staff-invitation-service";

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ invitationId: string }> },
) {
  const auth = await requireApiActor();
  if (auth.response) return auth.response;

  try {
    const { invitationId } = await context.params;
    await revokeStaffInvitation(auth.actor, invitationId);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return routeError(error);
  }
}
