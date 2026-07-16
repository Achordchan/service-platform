import { NextResponse } from "next/server";
import {
  requireApiActor,
  routeError,
} from "@/modules/projects/api-utils";
import { resendCustomerEmailChange } from "@/modules/users/customer-email-change-service";

export async function POST(
  _request: Request,
  context: { params: Promise<{ userId: string }> },
) {
  const auth = await requireApiActor();
  if (auth.response) return auth.response;
  try {
    const { userId } = await context.params;
    const result = await resendCustomerEmailChange(auth.actor, userId);
    return NextResponse.json({ data: result });
  } catch (error) {
    return routeError(error);
  }
}
