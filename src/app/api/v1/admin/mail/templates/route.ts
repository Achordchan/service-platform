import { NextResponse } from "next/server";
import { listMailTemplates } from "@/modules/platform-settings/mail-template-service";
import {
  requireApiActor,
  routeError,
} from "@/modules/projects/api-utils";

export async function GET() {
  const auth = await requireApiActor();
  if (auth.response) return auth.response;

  try {
    const templates = await listMailTemplates(auth.actor);
    return NextResponse.json({ data: templates });
  } catch (error) {
    return routeError(error);
  }
}
