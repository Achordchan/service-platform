import { NextResponse } from "next/server";
import {
  updateCustomerSpace,
} from "@/modules/customer-spaces/customer-space-service";
import { getCustomerSpace } from "@/modules/customer-spaces/customer-member-service";
import { updateCustomerSpaceSchema } from "@/modules/customer-spaces/schemas";
import {
  readJson,
  requireApiActor,
  routeError,
} from "@/modules/projects/api-utils";

type RouteContext = {
  params: Promise<{ customerSpaceId: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const auth = await requireApiActor();
  if (auth.response) return auth.response;

  try {
    const { customerSpaceId } = await context.params;
    const space = await getCustomerSpace(auth.actor, customerSpaceId);
    return NextResponse.json({ data: space });
  } catch (error) {
    return routeError(error);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  const auth = await requireApiActor();
  if (auth.response) return auth.response;

  try {
    const { customerSpaceId } = await context.params;
    const input = updateCustomerSpaceSchema.parse(await readJson(request));
    const space = await updateCustomerSpace(
      auth.actor,
      customerSpaceId,
      input,
    );
    return NextResponse.json({ data: space });
  } catch (error) {
    return routeError(error);
  }
}
