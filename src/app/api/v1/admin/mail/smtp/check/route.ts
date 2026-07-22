import { NextResponse } from "next/server";
import { requireApiActor, routeError } from "@/modules/projects/api-utils";
import { checkSmtpProvider } from "@/modules/platform-settings/smtp-provider-service";

export async function POST(request: Request) {
  const auth = await requireApiActor();
  if (auth.response) return auth.response;

  try {
    const settings = await checkSmtpProvider(auth.actor);
    return NextResponse.json({ data: settings });
  } catch (error) {
    return routeError(error, {
      request,
      operation: "mail.smtp.check",
    });
  }
}
