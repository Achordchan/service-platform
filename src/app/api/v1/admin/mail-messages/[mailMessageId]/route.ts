import { NextResponse } from "next/server";
import { cancelMailMessage } from "@/modules/platform-settings/mail-message-service";
import {
  requireApiActor,
  routeError,
} from "@/modules/projects/api-utils";

type RouteContext = {
  params: Promise<{ mailMessageId: string }>;
};

export async function DELETE(request: Request, context: RouteContext) {
  const auth = await requireApiActor();
  if (auth.response) return auth.response;

  try {
    const { mailMessageId } = await context.params;
    await cancelMailMessage(auth.actor, mailMessageId);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return routeError(error, {
      request,
      operation: "mail.outbox.cancel",
    });
  }
}
