import { NextResponse } from "next/server";
import {
  requireApiActor,
  routeError,
} from "@/modules/projects/api-utils";
import { resendUserEmailChange } from "@/modules/users/customer-email-change-service";

export async function POST() {
  const auth = await requireApiActor();
  if (auth.response) return auth.response;
  try {
    return NextResponse.json({
      data: await resendUserEmailChange(auth.actor, auth.actor.id),
    });
  } catch (error) {
    return routeError(error);
  }
}
