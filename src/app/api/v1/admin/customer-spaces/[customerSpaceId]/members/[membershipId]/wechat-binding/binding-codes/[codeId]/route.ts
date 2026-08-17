import { NextResponse } from "next/server";
import { revokeWechatBindingCode } from "@/modules/miniapp/binding-code-service";
import {
  requireApiActor,
  routeError,
} from "@/modules/projects/api-utils";

type RouteContext = {
  params: Promise<{
    customerSpaceId: string;
    membershipId: string;
    codeId: string;
  }>;
};

export async function DELETE(request: Request, context: RouteContext) {
  const auth = await requireApiActor();
  if (auth.response) return auth.response;

  try {
    const { customerSpaceId, membershipId, codeId } = await context.params;
    await revokeWechatBindingCode(
      auth.actor,
      customerSpaceId,
      membershipId,
      codeId,
    );
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return routeError(error, {
      request,
      operation: "admin.member.wechat_binding.code.revoke",
    });
  }
}
