import { NextResponse } from "next/server";
import { createOwnWechatBindingCode } from "@/modules/miniapp/binding-code-service";
import { requireApiActor, routeError } from "@/modules/projects/api-utils";

// 客户自助为本人生成微信绑定码（到小程序输入完成绑定）。
export async function POST() {
  const auth = await requireApiActor();
  if (auth.response) return auth.response;
  try {
    const result = await createOwnWechatBindingCode(auth.actor);
    return NextResponse.json({
      data: { code: result.code, expiresAt: result.expiresAt.toISOString() },
    });
  } catch (error) {
    return routeError(error);
  }
}
