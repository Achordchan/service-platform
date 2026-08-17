import "server-only";

import { headers } from "next/headers";
import type { Actor } from "@/lib/actor";
import { resolveActor } from "@/lib/actor";
import { getCurrentSession } from "@/lib/session";
import { resolveMiniappSessionFromAuthorization } from "@/modules/miniapp/session";

export type ApiActorResult =
  | { actor: Actor; failure?: never }
  | {
      actor?: never;
      failure: { code: string; message: string };
    };

/**
 * 统一 API Actor 解析入口。
 *
 * 优先级规则：只要请求携带 Authorization 头，就只按小程序 Bearer 会话验证，
 * 验证失败直接 401，绝不回落到 Cookie 会话；未携带 Authorization 时走
 * better-auth Cookie 会话。
 */
export async function resolveApiActor(): Promise<ApiActorResult> {
  const authorization = (await headers()).get("authorization");
  if (authorization) {
    const resolved = await resolveMiniappSessionFromAuthorization(
      authorization,
    );
    if (!resolved) {
      return {
        failure: {
          code: "UNAUTHORIZED",
          message: "小程序登录状态无效或已过期，请重新登录",
        },
      };
    }
    return { actor: resolved.actor };
  }

  const session = await getCurrentSession();
  if (!session) {
    return { failure: { code: "UNAUTHORIZED", message: "请先登录" } };
  }
  const actor = await resolveActor(session.user.id);
  if (!actor) {
    return { failure: { code: "UNAUTHORIZED", message: "当前账号不可用" } };
  }
  return { actor };
}
