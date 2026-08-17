import { NextResponse } from "next/server";
import { getMiniappMe } from "@/modules/miniapp/wechat-binding-service";
import { requireApiActor, routeError } from "@/modules/projects/api-utils";

export async function GET(request: Request) {
  const auth = await requireApiActor();
  if (auth.response) return auth.response;

  try {
    const data = await getMiniappMe(auth.actor);
    return NextResponse.json({ data });
  } catch (error) {
    return routeError(error, { request, operation: "miniapp.me" });
  }
}
