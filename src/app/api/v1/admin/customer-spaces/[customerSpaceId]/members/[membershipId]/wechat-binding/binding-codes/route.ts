import { NextResponse } from "next/server";
import { createWechatBindingCode } from "@/modules/miniapp/binding-code-service";
import {
  requireApiActor,
  routeError,
} from "@/modules/projects/api-utils";

type RouteContext = {
  params: Promise<{ customerSpaceId: string; membershipId: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  const auth = await requireApiActor();
  if (auth.response) return auth.response;

  try {
    const { customerSpaceId, membershipId } = await context.params;
    const data = await createWechatBindingCode(
      auth.actor,
      customerSpaceId,
      membershipId,
    );
    return NextResponse.json({ data }, { status: 201 });
  } catch (error) {
    return routeError(error, {
      request,
      operation: "admin.member.wechat_binding.code.create",
    });
  }
}
