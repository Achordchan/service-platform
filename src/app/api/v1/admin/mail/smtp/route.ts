import { NextResponse } from "next/server";
import { requireApiActor, routeError } from "@/modules/projects/api-utils";
import { disconnectSmtpProvider } from "@/modules/platform-settings/smtp-provider-service";

export async function DELETE(request: Request) {
  const auth = await requireApiActor();
  if (auth.response) return auth.response;

  try {
    const settings = await disconnectSmtpProvider(auth.actor);
    return NextResponse.json({ data: settings });
  } catch (error) {
    return routeError(error, {
      request,
      operation: "mail.smtp.disconnect",
    });
  }
}
