import { NextResponse } from "next/server";
import { requireApiActor } from "@/modules/projects/api-utils";
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  markProjectNotificationsRead,
  markRequestNotificationsRead,
} from "@/modules/notifications/notification-service";

export async function GET(request: Request) {
  const auth = await requireApiActor();
  if (auth.response) return auth.response;
  const actor = auth.actor;
  const url = new URL(request.url);
  const limitValue = Number(url.searchParams.get("limit") ?? "30");
  const limit = Number.isFinite(limitValue) ? limitValue : 30;
  return NextResponse.json({
    data: await listNotifications(actor, {
      limit,
      cursor: url.searchParams.get("cursor") ?? undefined,
    }),
  });
}

export async function PATCH(request: Request) {
  const auth = await requireApiActor();
  if (auth.response) return auth.response;
  const actor = auth.actor;
  const body = (await request.json()) as {
    id?: string;
    all?: boolean;
    serviceRequestId?: string;
    projectId?: string;
    projectScope?: "overview" | "updates" | "milestones" | "files" | "all";
  };

  if (body.all) {
    const result = await markAllNotificationsRead(actor);
    return NextResponse.json({
      data: { all: true, count: result.count },
    });
  }

  if (body.serviceRequestId) {
    const result = await markRequestNotificationsRead(
      actor,
      body.serviceRequestId,
    );
    return NextResponse.json({
      data: {
        serviceRequestId: body.serviceRequestId,
        count: result.count,
        read: true,
      },
    });
  }

  if (body.projectId) {
    const result = await markProjectNotificationsRead(
      actor,
      body.projectId,
      body.projectScope ?? "updates",
    );
    return NextResponse.json({
      data: {
        projectId: body.projectId,
        count: result.count,
        read: true,
      },
    });
  }

  if (!body.id) {
    return NextResponse.json({ error: "缺少通知编号" }, { status: 400 });
  }
  await markNotificationRead(actor, body.id);
  return NextResponse.json({ data: { id: body.id, read: true } });
}
