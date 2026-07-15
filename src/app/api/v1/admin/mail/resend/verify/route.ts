import { NextResponse } from "next/server";
import { requireApiActor, routeError } from "@/modules/projects/api-utils";
import { verifyResendDomain } from "@/modules/platform-settings/resend-provider-service";

export async function POST() {
  const auth = await requireApiActor();
  if (auth.response) return auth.response;

  try {
    const settings = await verifyResendDomain(auth.actor);
    return NextResponse.json({ data: settings });
  } catch (error) {
    return routeError(error);
  }
}
