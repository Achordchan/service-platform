import { NextResponse } from "next/server";
import { removeOwnWechatBinding } from "@/modules/miniapp/binding-code-service";
import { requireApiActor, routeError } from "@/modules/projects/api-utils";

// 客户自助解绑本人的微信绑定（个人设置「微信提醒」分区）。
export async function DELETE() {
  const auth = await requireApiActor();
  if (auth.response) return auth.response;
  try {
    return NextResponse.json({
      data: await removeOwnWechatBinding(auth.actor),
    });
  } catch (error) {
    return routeError(error);
  }
}
