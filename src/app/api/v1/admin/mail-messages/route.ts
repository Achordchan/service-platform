import { NextResponse } from "next/server";
import { listMailMessages } from "@/modules/platform-settings/platform-setting-service";
import {
  requireApiActor,
  routeError,
} from "@/modules/projects/api-utils";

export async function GET(request: Request) {
  const auth = await requireApiActor();
  if (auth.response) return auth.response;

  try {
    const { searchParams } = new URL(request.url);
    const limit = Number(searchParams.get("limit") ?? "50");
    const messages = await listMailMessages(
      auth.actor,
      Number.isFinite(limit) ? limit : 50,
    );
    return NextResponse.json({
      data: messages.map((message) => ({
        ...message,
        createdAt: message.createdAt.toISOString(),
        updatedAt: message.updatedAt.toISOString(),
        sentAt: message.sentAt?.toISOString() ?? null,
        lastEventAt: message.lastEventAt?.toISOString() ?? null,
      })),
    });
  } catch (error) {
    return routeError(error);
  }
}
