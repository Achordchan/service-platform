import { NextResponse } from "next/server";
import { listMiniappEvents } from "@/modules/miniapp/event-sync-service";
import {
  requireApiActor,
  routeError,
} from "@/modules/projects/api-utils";

export async function GET(request: Request) {
  const auth = await requireApiActor();
  if (auth.response) return auth.response;

  try {
    const url = new URL(request.url);
    const afterRaw = url.searchParams.get("after");
    let after = 0n;
    if (afterRaw !== null && afterRaw !== "") {
      if (!/^\d+$/.test(afterRaw)) {
        return NextResponse.json(
          {
            error: {
              code: "VALIDATION_ERROR",
              message: "after 必须是非负整数游标",
            },
          },
          { status: 422 },
        );
      }
      after = BigInt(afterRaw);
    }
    const limitRaw = url.searchParams.get("limit");
    const limit = limitRaw ? Number.parseInt(limitRaw, 10) : 100;
    if (!Number.isInteger(limit) || limit < 1) {
      return NextResponse.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "limit 必须是正整数",
          },
        },
        { status: 422 },
      );
    }
    const data = await listMiniappEvents(auth.actor, after, limit);
    return NextResponse.json({ data });
  } catch (error) {
    return routeError(error, { request, operation: "miniapp.events" });
  }
}
