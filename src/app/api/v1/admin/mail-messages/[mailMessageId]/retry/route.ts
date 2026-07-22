import { NextResponse } from "next/server";
import { retryMailMessage } from "@/modules/platform-settings/mail-message-service";
import {
  requireApiActor,
  routeError,
} from "@/modules/projects/api-utils";

type RouteContext = {
  params: Promise<{ mailMessageId: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  const auth = await requireApiActor();
  if (auth.response) return auth.response;

  try {
    const { mailMessageId } = await context.params;
    const message = await retryMailMessage(auth.actor, mailMessageId);
    return NextResponse.json(
      {
        data: {
          id: message.id,
          status: message.status,
          deliveryMode: message.deliveryMode,
        },
      },
      { status: 202 },
    );
  } catch (error) {
    return routeError(error, {
      request,
      operation: "mail.outbox.retry",
    });
  }
}
