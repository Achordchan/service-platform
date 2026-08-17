import { NextResponse } from "next/server";
import { getMiniappSpaceMembers } from "@/modules/miniapp/space-members-service";
import {
  requireApiActor,
  routeError,
} from "@/modules/projects/api-utils";

export async function GET(request: Request) {
  const auth = await requireApiActor();
  if (auth.response) return auth.response;

  try {
    const spaceId = new URL(request.url).searchParams.get("spaceId");
    if (!spaceId) {
      return NextResponse.json(
        { error: { code: "VALIDATION_ERROR", message: "缺少 spaceId" } },
        { status: 422 },
      );
    }
    const data = await getMiniappSpaceMembers(auth.actor, spaceId);
    return NextResponse.json({ data });
  } catch (error) {
    return routeError(error, {
      request,
      operation: "miniapp.space.members.list",
    });
  }
}
