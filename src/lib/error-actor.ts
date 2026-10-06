import "server-only";

import { headers } from "next/headers";
import { withSystemDb } from "@/lib/actor";
import type { SystemErrorActor } from "@/lib/system-error-log";
import { resolveApiActor } from "@/modules/http/api-actor";
import { hashExternalToken } from "@/modules/integrations/external/session-service";

/**
 * 报错时尽力识别当前请求的身份，只用于系统错误日志的「谁碰上了这个错」。
 * 必须在请求上下文里发起；任何一步失败（含数据库本身就是故障原因）都返回 undefined，
 * 绝不抛错。不走 requireExternalSession：它会刷新会话 lastSeenAt，且会话失效时抛错，
 * 错误日志不该有副作用。
 */
export async function resolveErrorActor(): Promise<SystemErrorActor | undefined> {
  try {
    const authorization = (await headers()).get("authorization") ?? "";
    const embed = /^Embed\s+([^\s]+)$/i.exec(authorization);
    if (embed) {
      const session = await withSystemDb((tx) =>
        tx.externalEmbedSession.findUnique({
          where: { tokenHash: hashExternalToken(embed[1]) },
          select: { externalContactId: true },
        }),
      );
      return session
        ? { type: "EXTERNAL_CONTACT", id: session.externalContactId }
        : undefined;
    }
    const resolved = await resolveApiActor();
    if (resolved.failure) return undefined;
    return {
      type: resolved.actor.platformRole === "CUSTOMER" ? "CUSTOMER" : "STAFF",
      id: resolved.actor.id,
    };
  } catch {
    return undefined;
  }
}
