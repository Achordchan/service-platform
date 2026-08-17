import { NextResponse } from "next/server";
import {
  getMemberWechatBindingStatus,
  removeWechatBinding,
} from "@/modules/miniapp/binding-code-service";
import {
  requireApiActor,
  routeError,
} from "@/modules/projects/api-utils";

type RouteContext = {
  params: Promise<{ customerSpaceId: string; membershipId: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  const auth = await requireApiActor();
  if (auth.response) return auth.response;

  try {
    const { customerSpaceId, membershipId } = await context.params;
    const data = await getMemberWechatBindingStatus(
      auth.actor,
      customerSpaceId,
      membershipId,
    );
    return NextResponse.json({ data });
  } catch (error) {
    return routeError(error, {
      request,
      operation: "admin.member.wechat_binding.get",
    });
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  const auth = await requireApiActor();
  if (auth.response) return auth.response;

  try {
    const { customerSpaceId, membershipId } = await context.params;
    const data = await removeWechatBinding(
      auth.actor,
      customerSpaceId,
      membershipId,
    );
    return NextResponse.json({ data });
  } catch (error) {
    return routeError(error, {
      request,
      operation: "admin.member.wechat_binding.remove",
    });
  }
}
