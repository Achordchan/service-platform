import { describeUserAgent, loginMethodFor } from "@/modules/audit/audit-presentation";
import type { AuditSessionView } from "@/modules/audit/audit-types";

/**
 * 由认证审计事件配对出「登录会话」。
 *
 * 纯函数、无数据库依赖，便于单测。精度分级：
 * - 有 `metadata.sessionId`：按会话 id 精确配对（新数据）；
 * - 旧数据：退化为「同一人、同 IP/UA 最近一次未关闭的登录」；
 * - 没有登出：有后续操作按最后操作估算，没有操作则标记「无法判断」。
 *
 * 这里计算的是「会话跨度」，不是用户在页面上的活跃停留。
 */

const LIVE_SESSION_MATCH_MS = 5 * 60_000;

export type AuditAuthEvent = {
  id: bigint;
  action: string;
  actorId: string | null;
  createdAt: Date;
  ipAddress: string | null;
  userAgent: string | null;
  metadata: unknown;
};

export type AuditLiveSession = {
  id: string;
  userId: string;
  createdAt: Date;
  expiresAt: Date;
  ipAddress: string | null;
  userAgent: string | null;
  client: "WEB" | "MINIAPP";
};

export type BuiltSession = {
  key: string;
  userId: string;
  startedAt: Date;
  endedAt: Date | null;
  durationMs: number | null;
  endReason: AuditSessionView["endReason"];
  ipAddress: string | null;
  userAgent: string | null;
  loginMethod: string | null;
};

function metadataRecord(metadata: unknown): Record<string, unknown> {
  return metadata && typeof metadata === "object" && !Array.isArray(metadata)
    ? (metadata as Record<string, unknown>)
    : {};
}

function sessionIdOf(metadata: unknown): string | null {
  const value = metadataRecord(metadata).sessionId;
  return typeof value === "string" && value ? value : null;
}

export function buildAuditSessions(
  events: AuditAuthEvent[],
  options: {
    now: Date;
    to: Date;
    lastActivityByUser?: Map<string, Date>;
    liveSessions?: AuditLiveSession[];
  },
): BuiltSession[] {
  const { now, to } = options;
  const lastActivityByUser = options.lastActivityByUser ?? new Map<string, Date>();
  const liveByUser = new Map<string, AuditLiveSession[]>();
  for (const session of options.liveSessions ?? []) {
    const list = liveByUser.get(session.userId) ?? [];
    list.push(session);
    liveByUser.set(session.userId, list);
  }

  const eventsByUser = new Map<string, AuditAuthEvent[]>();
  for (const event of events) {
    if (!event.actorId) continue;
    const list = eventsByUser.get(event.actorId) ?? [];
    list.push(event);
    eventsByUser.set(event.actorId, list);
  }

  const sessions: BuiltSession[] = [];

  for (const [userId, userEvents] of eventsByUser) {
    const ordered = [...userEvents].sort((left, right) => {
      const byTime = left.createdAt.getTime() - right.createdAt.getTime();
      if (byTime !== 0) return byTime;
      return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
    });

    const open: Array<{
      key: string;
      sessionId: string | null;
      startedAt: Date;
      ipAddress: string | null;
      userAgent: string | null;
      loginMethod: string | null;
    }> = [];

    for (const event of ordered) {
      if (event.action === "USER_LOGIN") {
        const sessionId = sessionIdOf(event.metadata);
        open.push({
          key: sessionId ?? `login-${event.id.toString()}`,
          sessionId,
          startedAt: event.createdAt,
          ipAddress: event.ipAddress,
          userAgent: event.userAgent,
          loginMethod: loginMethodFor(event.metadata),
        });
        continue;
      }

      if (event.action !== "USER_LOGOUT") continue;

      const sessionId = sessionIdOf(event.metadata);
      let index = sessionId
        ? open.findIndex((item) => item.sessionId === sessionId)
        : -1;
      // 有 sessionId 时只认精确匹配：配不上宁可忽略，也不要把并发的另一段会话关掉。
      // 旧数据没有 sessionId，才退化为「同 IP/UA 的最近一次登录」。
      if (!sessionId) {
        index = open.findLastIndex(
          (item) =>
            item.ipAddress === event.ipAddress &&
            item.userAgent === event.userAgent,
        );
        if (index < 0 && open.length > 0) index = open.length - 1;
      }
      if (index < 0) continue;

      const [matched] = open.splice(index, 1);
      if (!matched) continue;
      sessions.push(
        finishSession(matched, event.createdAt, "LOGGED_OUT", userId),
      );
    }

    const lastActivity = lastActivityByUser.get(userId) ?? null;
    const userLive = liveByUser.get(userId) ?? [];

    for (const pending of open) {
      // 新数据有 sessionId 时只认精确匹配；IP/UA 启发式只用于没有会话标识的旧数据
      const live = pending.sessionId
        ? userLive.find((session) => session.id === pending.sessionId)
        : userLive.find(
            (session) =>
              session.ipAddress === pending.ipAddress &&
              session.userAgent === pending.userAgent &&
              Math.abs(
                session.createdAt.getTime() - pending.startedAt.getTime(),
              ) < LIVE_SESSION_MATCH_MS,
          );

      if (live) {
        // 仍在登录：只统计到「现在 / 区间结束」，不把 7 天有效期当停留时长
        const end = new Date(Math.min(now.getTime(), to.getTime()));
        sessions.push(finishSession(pending, end, "ACTIVE", userId));
        continue;
      }

      if (lastActivity && lastActivity.getTime() > pending.startedAt.getTime()) {
        const end = new Date(Math.min(lastActivity.getTime(), to.getTime()));
        sessions.push(finishSession(pending, end, "STALE", userId));
        continue;
      }

      sessions.push({
        key: pending.key,
        userId,
        startedAt: pending.startedAt,
        endedAt: null,
        durationMs: null,
        endReason: "UNKNOWN",
        ipAddress: pending.ipAddress,
        userAgent: pending.userAgent,
        loginMethod: pending.loginMethod,
      });
    }
  }

  return sessions.sort(
    (left, right) => right.startedAt.getTime() - left.startedAt.getTime(),
  );
}

function finishSession(
  pending: {
    key: string;
    startedAt: Date;
    ipAddress: string | null;
    userAgent: string | null;
    loginMethod: string | null;
  },
  endedAt: Date,
  endReason: BuiltSession["endReason"],
  userId: string,
): BuiltSession {
  return {
    key: pending.key,
    userId,
    startedAt: pending.startedAt,
    endedAt,
    durationMs: Math.max(0, endedAt.getTime() - pending.startedAt.getTime()),
    endReason,
    ipAddress: pending.ipAddress,
    userAgent: pending.userAgent,
    loginMethod: pending.loginMethod,
  };
}

const END_REASON_LABELS: Record<AuditSessionView["endReason"], string> = {
  LOGGED_OUT: "已正常登出",
  ACTIVE: "仍在登录",
  STALE: "未登出（按最后操作估算）",
  UNKNOWN: "无法判断",
};

export function toSessionViews(
  sessions: BuiltSession[],
  limit = 100,
): AuditSessionView[] {
  return sessions.slice(0, limit).map((session) => ({
    key: session.key,
    startedAt: session.startedAt.toISOString(),
    endedAt: session.endedAt?.toISOString() ?? null,
    durationMs: session.durationMs,
    endReason: session.endReason,
    endReasonLabel: END_REASON_LABELS[session.endReason],
    ipAddress: session.ipAddress,
    device: describeUserAgent(session.userAgent),
    loginMethod: session.loginMethod,
  }));
}
