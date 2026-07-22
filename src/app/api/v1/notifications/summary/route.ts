import { NextResponse } from "next/server";
import { requireUserWithAccess } from "@/lib/session";
import { getNotificationSummary } from "@/modules/notifications/notification-service";

export async function GET() {
  const { actor } = await requireUserWithAccess();
  return NextResponse.json({ data: await getNotificationSummary(actor) });
}
