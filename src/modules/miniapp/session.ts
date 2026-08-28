import "server-only";

import type { Actor } from "@/lib/actor";
import { resolveActor } from "@/lib/actor";
import { prisma } from "@/lib/db";
import {
  hashSecretToken,
  MINIAPP_SESSION_TTL_MS,
} from "@/modules/miniapp/miniapp-tokens";

// 与 better-auth updateAge 类似：超过该间隔未活跃才延长会话，避免每请求写库
const MINIAPP_SESSION_UPDATE_AGE_MS = 60 * 60 * 1000;

export type MiniappSessionContext = {
  actor: Actor;
  sessionId: string;
  userId: string;
};

export async function resolveMiniappSessionFromAuthorization(
  authorization: string | null,
): Promise<MiniappSessionContext | null> {
  const token = extractBearerToken(authorization);
  if (!token) return null;

  const record = await prisma.miniappSession.findUnique({
    where: { tokenHash: hashSecretToken(token) },
    select: {
      id: true,
      userId: true,
      expiresAt: true,
      revokedAt: true,
      lastSeenAt: true,
      user: { select: { deletedAt: true } },
    },
  });
  // 客户与内部人员（项目经理/技术/平台管理员）均可持有小程序会话，
  // 数据可见性与操作权限由 /api/v1 服务层按 actor（RLS + 权限函数）裁决。
  if (
    !record ||
    record.revokedAt ||
    record.expiresAt.getTime() <= Date.now() ||
    record.user.deletedAt
  ) {
    return null;
  }
  const actor = await resolveActor(record.userId);
  if (!actor) return null;

  const now = new Date();
  if (
    !record.lastSeenAt ||
    now.getTime() - record.lastSeenAt.getTime() > MINIAPP_SESSION_UPDATE_AGE_MS
  ) {
    await prisma.miniappSession
      .update({
        where: { id: record.id },
        data: {
          lastSeenAt: now,
          expiresAt: new Date(now.getTime() + MINIAPP_SESSION_TTL_MS),
        },
      })
      .catch(() => undefined);
  }
  return { actor, sessionId: record.id, userId: record.userId };
}

export async function revokeMiniappSessionByAuthorization(
  authorization: string | null,
): Promise<boolean> {
  const token = extractBearerToken(authorization);
  if (!token) return false;
  const result = await prisma.miniappSession.updateMany({
    where: { tokenHash: hashSecretToken(token), revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return result.count > 0;
}

function extractBearerToken(authorization: string | null): string | null {
  if (!authorization) return null;
  const schemeEnd = authorization.indexOf(" ");
  const scheme =
    schemeEnd === -1 ? authorization : authorization.slice(0, schemeEnd);
  if (scheme.toLowerCase() !== "bearer") return null;
  const token = authorization.slice(schemeEnd + 1).trim();
  return token ? token : null;
}
