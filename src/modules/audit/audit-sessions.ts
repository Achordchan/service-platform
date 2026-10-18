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

function loginClientFor(
  metadata: unknown,
  ipAddress: string | null,
  userAgent: string | null,
): "WEB" | "MINIAPP" {
  const path =
    metadata && typeof metadata === "object" && !Array.isArray(metadata)
      ? (metadata as Record<string, unknown>).path
      : null;
  if (path === "miniapp" || path === "miniapp-bind") return "MINIAPP";
  // 更早的小程序登录没有 path，通常也没有 IP/UA；否则按 Web 处理
  if (!path && !ipAddress && !userAgent) return "MINIAPP";
  return "WEB";
}

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

  // 新登出会带 sessionStartedAt。如果对应的登录事件已在 30 天窗口外，
  // 用登出里的开始时间补一条登录；但部署前已有的无 sessionId 登录要先认领，
  // 否则同一次登录会同时留下旧登录和合成登录两条会话。
  const working = events.map((event) => ({ ...event }));
  const loginSessionIds = new Set(
    working
      .filter((event) => event.action === "USER_LOGIN")
      .map((event) => sessionIdOf(event.metadata))
      .filter((id): id is string => Boolean(id)),
  );
  const synthesized: AuditAuthEvent[] = [];
  const synthesizedIds = new Set<string>();
  const usedLegacyLoginIds = new Set<string>();
  const closedAtByLoginId = new Map<string, number>();
  let syntheticId = -1n;

  // 先按现有配对规则模拟一遍，找出已被更早登出关闭的旧登录；
  // 这些登录不能再被后面的新登出认领。
  {
    const open: AuditAuthEvent[] = [];
    const sorted = [...working].sort(
      (left, right) => left.createdAt.getTime() - right.createdAt.getTime(),
    );
    for (const event of sorted) {
      if (event.action === "USER_LOGIN") {
        open.push(event);
        continue;
      }
      if (event.action !== "USER_LOGOUT") continue;
      const eventSessionId = sessionIdOf(event.metadata);
      let index = eventSessionId
        ? open.findIndex(
            (item) => sessionIdOf(item.metadata) === eventSessionId,
          )
        : -1;
      if (index < 0) {
        const candidates = open.filter(
          (item) =>
            (eventSessionId ? sessionIdOf(item.metadata) === null : true) &&
            item.ipAddress === event.ipAddress &&
            item.userAgent === event.userAgent,
        );
        if (candidates.length === 1) index = open.indexOf(candidates[0]!);
      }
      if (index < 0 && !eventSessionId && open.length === 1) index = 0;
      if (index < 0) continue;
      const [closed] = open.splice(index, 1);
      if (closed) closedAtByLoginId.set(closed.id.toString(), event.createdAt.getTime());
    }
  }
  for (const event of working) {
    if (event.action !== "USER_LOGOUT" || !event.actorId) continue;
    const sessionId = sessionIdOf(event.metadata);
    if (!sessionId || loginSessionIds.has(sessionId)) continue;
    const startedAtValue = metadataRecord(event.metadata).sessionStartedAt;
    if (typeof startedAtValue !== "string") continue;
    const startedAt = new Date(startedAtValue);
    if (
      Number.isNaN(startedAt.getTime()) ||
      startedAt.getTime() >= event.createdAt.getTime()
    ) {
      continue;
    }

    // 先按「同人 + 开始时间」找唯一的部署前旧登录，给它补上 sessionId
    const legacyCandidates = working.filter(
      (candidate) =>
        candidate.action === "USER_LOGIN" &&
        candidate.actorId === event.actorId &&
        sessionIdOf(candidate.metadata) === null &&
        !usedLegacyLoginIds.has(candidate.id.toString()) &&
        // 已被更早的登出关闭的登录不能认领；由当前登出自己关闭的可以
        (closedAtByLoginId.get(candidate.id.toString()) ?? Number.POSITIVE_INFINITY) >=
          event.createdAt.getTime() &&
        Math.abs(
          candidate.createdAt.getTime() - startedAt.getTime(),
        ) < LIVE_SESSION_MATCH_MS,
    );
    if (legacyCandidates.length === 1) {
      const candidate = legacyCandidates[0]!;
      const index = working.findIndex((item) => item.id === candidate.id);
      if (index >= 0) {
        const existing = working[index]!;
        working[index] = {
          ...existing,
          metadata: { ...metadataRecord(existing.metadata), sessionId },
        };
        usedLegacyLoginIds.add(candidate.id.toString());
        loginSessionIds.add(sessionId);
      }
      continue;
    }
    // 多个旧候选说明这次登出归属本身不唯一，不要再造一条会话
    if (legacyCandidates.length > 1) continue;
    if (synthesizedIds.has(sessionId)) continue;
    synthesizedIds.add(sessionId);
    const path = metadataRecord(event.metadata).path;
    synthesized.push({
      id: syntheticId--,
      action: "USER_LOGIN",
      actorId: event.actorId,
      createdAt: startedAt,
      ipAddress: event.ipAddress,
      userAgent: event.userAgent,
      metadata: {
        sessionId,
        synthesized: true,
        ...(typeof path === "string" ? { path } : {}),
      },
    });
  }
  const allEvents =
    synthesized.length > 0 ? [...working, ...synthesized] : working;

  const eventsByUser = new Map<string, AuditAuthEvent[]>();
  for (const event of allEvents) {
    if (!event.actorId) continue;
    const list = eventsByUser.get(event.actorId) ?? [];
    list.push(event);
    eventsByUser.set(event.actorId, list);
  }

  const sessions: BuiltSession[] = [];
  const userIds = new Set([...eventsByUser.keys(), ...liveByUser.keys()]);

  for (const userId of userIds) {
    const userEvents = eventsByUser.get(userId) ?? [];
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
      client: "WEB" | "MINIAPP";
      /** 下一次登录的时间：估计旧会话结束的上界，避免把后续操作算到旧会话上 */
      nextLoginAt: Date | null;
    }> = [];

    for (const event of ordered) {
      if (event.action === "USER_LOGIN") {
        // 同一用户又登录了一次：之前仍未关闭的会话最晚到这次登录为止
        for (const item of open) {
          if (!item.nextLoginAt) item.nextLoginAt = event.createdAt;
        }
        const sessionId = sessionIdOf(event.metadata);
        open.push({
          key: sessionId ?? `login-${event.id.toString()}`,
          sessionId,
          startedAt: event.createdAt,
          ipAddress: event.ipAddress,
          userAgent: event.userAgent,
          loginMethod: loginMethodFor(event.metadata),
          client: loginClientFor(event.metadata, event.ipAddress, event.userAgent),
          nextLoginAt: null,
        });
        continue;
      }

      if (event.action !== "USER_LOGOUT") continue;

      const sessionId = sessionIdOf(event.metadata);
      let index = sessionId
        ? open.findIndex((item) => item.sessionId === sessionId)
        : -1;
      // 新格式登出配不上时，只回退到没有 sessionId 的旧登录；且必须唯一候选。
      // 这样既能关掉「部署前登录、部署后登出」的真实会话，又不会误关并发会话。
      if (index < 0) {
        const candidates = open
          .map((item, candidateIndex) => ({ item, candidateIndex }))
          .filter(
            ({ item }) =>
              (sessionId ? item.sessionId === null : true) &&
              item.ipAddress === event.ipAddress &&
              item.userAgent === event.userAgent,
          );
        if (candidates.length === 1) index = candidates[0]!.candidateIndex;
      }
      // 完全没有会话标识的旧登出，只有一个未关闭登录时才敢兜底关它
      if (index < 0 && !sessionId && open.length === 1) index = 0;
      if (index < 0) continue;

      const [matched] = open.splice(index, 1);
      if (!matched) continue;
      sessions.push(
        finishSession(matched, event.createdAt, "LOGGED_OUT", userId),
      );
    }

    const lastActivity = lastActivityByUser.get(userId) ?? null;
    const userLive = liveByUser.get(userId) ?? [];
    const matchedLiveIds = new Set<string>();
    const liveByPendingKey = new Map<string, AuditLiveSession>();

    // 先为有 sessionId 的登录保留精确匹配的 live session。否则滚动发布时，
    // 同一浏览器里更早的无标识旧登录可能先按 IP/UA 抢走新会话。
    for (const pending of open) {
      if (!pending.sessionId) continue;
      const live = userLive.find(
        (session) =>
          !matchedLiveIds.has(session.id) &&
          session.id === pending.sessionId,
      );
      if (!live) continue;
      matchedLiveIds.add(live.id);
      liveByPendingKey.set(pending.key, live);
    }

    // 旧登录再去认领剩下的 live session；多个候选时保守放弃
    for (const pending of open) {
      if (pending.sessionId) continue;
      const candidates = userLive.filter(
        (session) =>
          !matchedLiveIds.has(session.id) &&
          session.client === pending.client &&
          Math.abs(
            session.createdAt.getTime() - pending.startedAt.getTime(),
          ) < LIVE_SESSION_MATCH_MS &&
          // 小程序会话没有 IP/UA；Web 会话的 IP 可能因代理与审计行不同，
          // 因此时间窗内 IP 或 UA 任一匹配即可，两者都不同才不配对。
          (session.client === "MINIAPP" ||
            session.ipAddress === pending.ipAddress ||
            session.userAgent === pending.userAgent),
      );
      if (candidates.length !== 1) continue;
      matchedLiveIds.add(candidates[0]!.id);
      liveByPendingKey.set(pending.key, candidates[0]!);
    }

    for (const pending of open) {
      const live = liveByPendingKey.get(pending.key);
      if (live) {
        // 仍在登录：会话本身统计到「现在」，区间截取交给 sessionDurationWithinRange
        sessions.push(finishSession(pending, now, "ACTIVE", userId));
        continue;
      }

      if (lastActivity && lastActivity.getTime() > pending.startedAt.getTime()) {
        // 后续操作如果发生在下一次登录之后，应归到新会话，不能拿来延长旧会话
        const estimatedEnd =
          pending.nextLoginAt &&
          lastActivity.getTime() > pending.nextLoginAt.getTime()
            ? pending.nextLoginAt
            : lastActivity;
        const end = new Date(Math.min(estimatedEnd.getTime(), to.getTime()));
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

    // 仍有效的会话可能来自窗口外，甚至早于 sessionId 上线：没有登录事件时
    // 直接用 Session 行本身补一段「登录中」，否则它会在登录会话列表里消失。
    // 只给「没有被任何登录事件实际匹配到」的 live session 补录，避免同一次登录
    // 既被旧登录认领、又生成一条重复会话。
    for (const live of userLive) {
      if (live.createdAt.getTime() > to.getTime()) continue;
      if (matchedLiveIds.has(live.id)) continue;
      if (now.getTime() < live.createdAt.getTime()) continue;
      const end = now;
      sessions.push({
        key: live.id,
        userId,
        startedAt: live.createdAt,
        endedAt: end,
        durationMs: end.getTime() - live.createdAt.getTime(),
        endReason: "ACTIVE",
        ipAddress: live.ipAddress,
        userAgent: live.userAgent,
        loginMethod: null,
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

/**
 * 会话是否与统计区间有交集。区间外的会话不计入；跨区间起止的会话要计入。
 * UNKNOWN 没有结束时间，只能按「登录发生在区间内」判断。
 */
export function sessionOverlapsRange(
  session: BuiltSession,
  from: Date,
  to: Date,
  now = new Date(),
): boolean {
  if (session.endReason === "UNKNOWN") {
    return (
      session.startedAt.getTime() >= from.getTime() &&
      session.startedAt.getTime() <= to.getTime()
    );
  }
  const end = session.endedAt ?? now;
  return (
    session.startedAt.getTime() <= to.getTime() &&
    end.getTime() >= from.getTime()
  );
}

/**
 * 会话落在统计区间内的时长。跨区间的会话只计入区间内的那一段，
 * 避免「今天」把昨天开始的会话整段算进来，也避免历史区间计入今天的新登录。
 */
export function sessionDurationWithinRange(
  session: BuiltSession,
  from: Date,
  to: Date,
  now = new Date(),
): number | null {
  if (session.endReason === "UNKNOWN") return null;
  const end = session.endedAt ?? now;
  if (
    session.startedAt.getTime() > to.getTime() ||
    end.getTime() < from.getTime()
  ) {
    return null;
  }
  const startMs = Math.max(session.startedAt.getTime(), from.getTime());
  const endMs = Math.min(end.getTime(), to.getTime());
  return endMs >= startMs ? endMs - startMs : null;
}

const END_REASON_LABELS: Record<AuditSessionView["endReason"], string> = {
  LOGGED_OUT: "已正常登出",
  ACTIVE: "仍在登录",
  STALE: "未登出（按最后操作估算）",
  UNKNOWN: "无法判断",
};

export function toSessionViews(
  sessions: BuiltSession[],
  limit?: number,
): AuditSessionView[] {
  const visible =
    typeof limit === "number" ? sessions.slice(0, limit) : sessions;
  return visible.map((session) => ({
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
