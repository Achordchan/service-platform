import { NextResponse } from "next/server";
import { createInvitation } from "@/modules/customer-spaces/customer-member-service";
import { createInvitationSchema } from "@/modules/customer-spaces/schemas";
import {
  readJson,
  requireApiActor,
  routeError,
} from "@/modules/projects/api-utils";

type RouteContext = {
  params: Promise<{ customerSpaceId: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  const auth = await requireApiActor();
  if (auth.response) return auth.response;

  try {
    const { customerSpaceId } = await context.params;
    const input = createInvitationSchema.parse(await readJson(request));
    const invitation = await createInvitation(
      auth.actor,
      customerSpaceId,
      input,
    );
    return NextResponse.json({ data: invitation }, { status: 201 });
  } catch (error) {
    return routeError(error);
  }
}
