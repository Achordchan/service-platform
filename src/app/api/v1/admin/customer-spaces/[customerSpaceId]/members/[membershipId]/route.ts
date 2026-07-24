import { NextResponse } from "next/server";
import {
  removeCustomerSpaceMember,
  updateCustomerSpaceMember,
} from "@/modules/customer-spaces/customer-member-service";
import { updateCustomerSpaceMemberSchema } from "@/modules/customer-spaces/schemas";
import {
  readJson,
  requireApiActor,
  routeError,
} from "@/modules/projects/api-utils";

type RouteContext = {
  params: Promise<{
    customerSpaceId: string;
    membershipId: string;
  }>;
};

export async function PATCH(request: Request, context: RouteContext) {
  const auth = await requireApiActor();
  if (auth.response) return auth.response;

  try {
    const { customerSpaceId, membershipId } = await context.params;
    const input = updateCustomerSpaceMemberSchema.parse(await readJson(request));
    const user = await updateCustomerSpaceMember(
      auth.actor,
      customerSpaceId,
      membershipId,
      input,
    );
    return NextResponse.json({ data: user });
  } catch (error) {
    return routeError(error, {
      request,
      operation: "customer_space.member.update",
    });
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  const auth = await requireApiActor();
  if (auth.response) return auth.response;

  try {
    const { customerSpaceId, membershipId } = await context.params;
    const result = await removeCustomerSpaceMember(
      auth.actor,
      customerSpaceId,
      membershipId,
    );
    return NextResponse.json({ data: result });
  } catch (error) {
    return routeError(error, {
      request,
      operation: "customer_space.member.delete",
    });
  }
}
