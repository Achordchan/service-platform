import { NextResponse } from "next/server";
import {
  readJson,
  requireApiActor,
  routeError,
} from "@/modules/projects/api-utils";
import {
  disconnectResendProvider,
  setupResendProvider,
} from "@/modules/platform-settings/resend-provider-service";
import { setupResendSchema } from "@/modules/platform-settings/schemas";

export async function POST(request: Request) {
  const auth = await requireApiActor();
  if (auth.response) return auth.response;

  try {
    const input = setupResendSchema.parse(await readJson(request));
    const settings = await setupResendProvider(auth.actor, input);
    return NextResponse.json({ data: settings });
  } catch (error) {
    return routeError(error);
  }
}

export async function DELETE() {
  const auth = await requireApiActor();
  if (auth.response) return auth.response;

  try {
    const settings = await disconnectResendProvider(auth.actor);
    return NextResponse.json({ data: settings });
  } catch (error) {
    return routeError(error);
  }
}
