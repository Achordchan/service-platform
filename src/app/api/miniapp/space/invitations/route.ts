import { NextResponse } from "next/server";
import { createInvitation } from "@/modules/customer-spaces/customer-member-service";
import { createInvitationSchema } from "@/modules/customer-spaces/schemas";
import {
  readJson,
  requireApiActor,
  routeError,
} from "@/modules/projects/api-utils";

export async function POST(request: Request) {
  const auth = await requireApiActor();
  if (auth.response) return auth.response;

  try {
    const input = createInvitationSchema.parse(await readJson(request));
    const spaceId = new URL(request.url).searchParams.get("spaceId");
    if (!spaceId) {
      return NextResponse.json(
        { error: { code: "VALIDATION_ERROR", message: "缺少 spaceId" } },
        { status: 422 },
      );
    }
    await createInvitation(auth.actor, spaceId, input);
    return new NextResponse(null, { status: 201 });
  } catch (error) {
    return routeError(error, {
      request,
      operation: "miniapp.space.invitations.create",
    });
  }
}
