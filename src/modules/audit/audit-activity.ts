import "server-only";

import { parseISO } from "date-fns";
import type { Prisma } from "@/generated/prisma/client";
import type { Actor } from "@/lib/actor";
import { withActorDb } from "@/lib/actor";
import {
  AUDIT_PAGE_SIZE_MAX,
  auditCategoryWhereForDb,
  auditRecordSelect,
  loadAuditReferences,
  mapAuditRecords,
} from "@/modules/audit/audit-query";
import {
  auditCategoryFor,
  auditCategoryLabel,
  describeUserAgent,
  platformRoleLabel,
} from "@/modules/audit/audit-presentation";
import {
  buildAuditSessions,
  sessionDurationWithinRange,
  sessionOverlapsRange,
  toSessionViews,
  type AuditAuthEvent,
  type BuiltSession,
} from "@/modules/audit/audit-sessions";
import type {
  AuditCategoryKey,
  AuditOverview,
  AuditPeoplePage,
  AuditPersonActivityRow,
  AuditPersonDetail,
} from "@/modules/audit/audit-types";
import { AUDIT_ACTIVITY_RANGE_MAX_DAYS } from "@/modules/audit/audit-range";
import { assertAllowed } from "@/modules/projects/errors";

const ROUTINE_AUTH_ACTIONS = ["USER_LOGIN", "USER_LOGOUT"] as const;
const NON_ACTIVITY_ACTIONS = [
  "USER_LOGIN",
  "USER_LOGOUT",
  "USER_LOGIN_FAILED",
  "USER_PASSWORD_RESET_REQUESTED",
  "USER_PASSWORD_RESET_COMPLETED",
];

const TIME_ZONE = "Asia/Shanghai";
// Web 会话 7 天、小程序会话 30 天；更早的会话由「按 sessionId 回查登录」兜底
const SESSION_LOOKBACK_MS = 30 * 24 * 60 * 60_000;
// 历史区间之后的登出最多看 30 天：既够用来判断会话是否跨越区间结束，
// 又不会因为查几年前的区间而把之后几年的认证事件全拉出来
const AUTH_LOOKAHEAD_MS = 30 * 24 * 60 * 60_000;

/** 改密后 better-auth 会重建会话并发一条 USER_LOGIN，它不是一次真实登录。 */
function isCredentialLogin(metadata: unknown): boolean {
  return metadata && typeof metadata === "object" && !Array.isArray(metadata)
    ? (metadata as Record<string, unknown>).path !== "/change-password"
    : true;
}

function sessionIdOf(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return null;
  }
  const value = (metadata as Record<string, unknown>).sessionId;
  return typeof value === "string" && value ? value : null;
}

/**
 * 认证事件不能只取 [from, to]：
 * - 登出可能发生在 to 之后，缺了它会话只能算「未知」；
 * - 后续登录要一起取，否则旧登录会跟更晚的登出错误配对；
 * - 登录可能早于 30 天 lookback，但登出在区间内；
 * - 续期很久的会话，登出可能在 to + 30d 之后。
 * 因此先取 [from - 30d, to + 30d]，再按已知 sessionId 回查窗口外的登录/登出。
 */
type RawAuthRow = {
  id: bigint;
  action: string;
  actorId: string | null;
  createdAt: Date;
  ipAddress: string | null;
  userAgent: string | null;
  metadata: unknown;
};

function toAuthEvent(row: RawAuthRow): AuditAuthEvent {
  return {
    id: row.id,
    action: row.action,
    actorId: row.actorId,
    createdAt: row.createdAt,
    ipAddress: row.ipAddress,
    userAgent: row.userAgent,
    metadata: row.metadata,
  };
}

async function loadAuthEventsForRange(
  tx: Prisma.TransactionClient,
  params: {
    from: Date;
    to: Date;
    now: Date;
    actorId?: string;
    requireActor?: boolean;
  },
): Promise<AuditAuthEvent[]> {
  const lookbackStart = new Date(params.from.getTime() - SESSION_LOOKBACK_MS);
  const lookaheadEnd = new Date(
    Math.min(params.to.getTime() + AUTH_LOOKAHEAD_MS, params.now.getTime()),
  );
  const events = await tx.auditLog.findMany({
    where: {
      ...(params.actorId ? { actorId: params.actorId } : {}),
      ...(params.requireActor ? { actorId: { not: null } } : {}),
      action: { in: ["USER_LOGIN", "USER_LOGOUT"] },
      createdAt: { gte: lookbackStart, lte: lookaheadEnd },
    },
    select: {
      id: true,
      action: true,
      actorId: true,
      createdAt: true,
      ipAddress: true,
      userAgent: true,
      metadata: true,
    },
    orderBy: { createdAt: "asc" },
  });

  const actorFilter = params.actorId ?? null;
  const loginSessionIds = [
    ...new Set(
      events
        .map((event) =>
          event.action === "USER_LOGIN" ? sessionIdOf(event.metadata) : null,
        )
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const closedSessionIds = new Set(
    events
      .map((event) =>
        event.action === "USER_LOGOUT" ? sessionIdOf(event.metadata) : null,
      )
      .filter((id): id is string => Boolean(id)),
  );
  const unclosedSessionIds = loginSessionIds.filter(
    (id) => !closedSessionIds.has(id),
  );

  // 登录在窗口内、登出在 to + 30d 之后：按 sessionId 把之后的登出也找回来
  const logoutRows =
    unclosedSessionIds.length > 0
      ? await tx.$queryRaw<RawAuthRow[]>`
          SELECT
            id, action, "actorId", "createdAt", "ipAddress", "userAgent", metadata
          FROM "AuditLog"
          WHERE action = 'USER_LOGOUT'
            AND "createdAt" <= ${params.now}
            AND metadata->>'sessionId' = ANY(${unclosedSessionIds}::text[])
            AND (${actorFilter}::text IS NULL OR "actorId" = ${actorFilter})
        `
      : [];

  // 登出在窗口内、登录早于 lookback：按 sessionId 回查更早的登录
  const logoutSessionIds = [
    ...new Set(
      [...events, ...logoutRows]
        .map((event) =>
          event.action === "USER_LOGOUT" ? sessionIdOf(event.metadata) : null,
        )
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const loginRows =
    logoutSessionIds.length > 0
      ? await tx.$queryRaw<RawAuthRow[]>`
          SELECT
            id, action, "actorId", "createdAt", "ipAddress", "userAgent", metadata
          FROM "AuditLog"
          WHERE action = 'USER_LOGIN'
            AND "createdAt" <= ${params.now}
            AND metadata->>'sessionId' = ANY(${logoutSessionIds}::text[])
            AND (${actorFilter}::text IS NULL OR "actorId" = ${actorFilter})
        `
      : [];

  const seen = new Set(events.map((event) => event.id.toString()));
  const merged: AuditAuthEvent[] = [...events];
  for (const row of [...logoutRows, ...loginRows]) {
    if (seen.has(row.id.toString())) continue;
    seen.add(row.id.toString());
    merged.push(toAuthEvent(row));
  }
  return merged;
}

const SHANGHAI_DAY_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function shanghaiDayKey(date: Date): string {
  const parts = SHANGHAI_DAY_FORMATTER.formatToParts(date);
  const pick = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${pick("year")}-${pick("month")}-${pick("day")}`;
}

function eachShanghaiDay(from: Date, to: Date): string[] {
  const start = parseISO(`${shanghaiDayKey(from)}T00:00:00Z`);
  const end = parseISO(`${shanghaiDayKey(to)}T00:00:00Z`);
  const days: string[] = [];
  let cursor = start;
  while (cursor <= end && days.length < AUDIT_ACTIVITY_RANGE_MAX_DAYS) {
    days.push(cursor.toISOString().slice(0, 10));
    // 固定 UTC 加 24h，避免服务器本地 DST 让某一天被跳过/重复
    cursor = new Date(cursor.getTime() + 86_400_000);
  }
  return days;
}

type TrendRow = {
  date: string;
  actions: number;
  activePeople: number;
  logins: number;
};

type RangedSession = {
  session: BuiltSession;
  durationMs: number | null;
};

function sessionMetricsWithinRange(
  sessions: BuiltSession[],
  from: Date,
  to: Date,
  now: Date,
): RangedSession[] {
  return sessions
    .filter((session) => sessionOverlapsRange(session, from, to, now))
    .map((session) => ({
      session,
      durationMs: sessionDurationWithinRange(session, from, to, now),
    }));
}

function averageDuration(sessions: RangedSession[]): number | null {
  // 平均值只统计「有明确登出」的会话。进行中的会随时间变大，
  // 未登出的只能按最后操作估算，混进平均值会系统性偏高。
  const measured = sessions.filter(
    (item) => item.session.endReason === "LOGGED_OUT" && item.durationMs !== null,
  );
  if (measured.length === 0) return null;
  const total = measured.reduce((sum, item) => sum + (item.durationMs ?? 0), 0);
  return Math.round(total / measured.length);
}

export async function getAuditOverview(
  actor: Actor,
  range: { from: Date; to: Date },
  now = new Date(),
): Promise<AuditOverview> {
  assertAllowed(actor.isPlatformAdmin);
  const { from, to } = range;

  return withActorDb(actor, async (tx) => {
    // 事务内只有一个连接：所有查询顺序执行，避免 pg 重入
    const authEvents = await loadAuthEventsForRange(tx, { from, to, now });

    const lastActivityRows = await tx.auditLog.groupBy({
      by: ["actorId"],
      where: {
        actorId: { not: null },
        createdAt: { gte: from, lte: to },
        action: { notIn: NON_ACTIVITY_ACTIONS },
      },
      _max: { createdAt: true },
    });

    const liveWebSessions = await tx.session.findMany({
      where: { expiresAt: { gt: now } },
      select: {
        id: true,
        userId: true,
        createdAt: true,
        expiresAt: true,
        ipAddress: true,
        userAgent: true,
        user: {
          select: {
            name: true,
            email: true,
            platformRole: true,
            roleGroup: { select: { name: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });
    const liveMiniappSessions = await tx.miniappSession.findMany({
      where: { expiresAt: { gt: now }, revokedAt: null },
      select: {
        id: true,
        userId: true,
        createdAt: true,
        expiresAt: true,
        user: {
          select: {
            name: true,
            email: true,
            platformRole: true,
            roleGroup: { select: { name: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });
    const liveSessions = [
      ...liveWebSessions.map((session) => ({ ...session, client: "WEB" as const })),
      ...liveMiniappSessions.map((session) => ({
        ...session,
        ipAddress: null,
        userAgent: null,
        client: "MINIAPP" as const,
      })),
    ];

    const trendRows = await tx.$queryRaw<TrendRow[]>`
      SELECT
        -- createdAt 是 timestamp(3)，Prisma 按 UTC 写入；先按 UTC 还原瞬间，
        -- 再转北京时间，避免依赖数据库会话时区（改为 UTC 时会整体偏一天）。
        to_char(
          (("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE ${TIME_ZONE})::date,
          'YYYY-MM-DD'
        ) AS date,
        COUNT(*)::int AS actions,
        COUNT(DISTINCT "actorId")::int AS "activePeople",
        COUNT(*) FILTER (
          WHERE action = 'USER_LOGIN'
            AND coalesce(metadata->>'path', '') <> '/change-password'
        )::int AS logins
      FROM "AuditLog"
      WHERE "createdAt" >= ${from} AND "createdAt" <= ${to}
      GROUP BY 1
      ORDER BY 1 ASC
    `;

    const totalsRows = await tx.$queryRaw<
      Array<{
        actionCount: number;
        activePeople: number;
        loginCount: number;
        failedLoginCount: number;
      }>
    >`
      SELECT
        COUNT(*)::int AS "actionCount",
        COUNT(DISTINCT "actorId")::int AS "activePeople",
        COUNT(*) FILTER (
          WHERE action = 'USER_LOGIN'
            AND coalesce(metadata->>'path', '') <> '/change-password'
        )::int AS "loginCount",
        COUNT(*) FILTER (WHERE action = 'USER_LOGIN_FAILED')::int AS "failedLoginCount"
      FROM "AuditLog"
      WHERE "createdAt" >= ${from} AND "createdAt" <= ${to}
    `;

    const recentLoginRecords = await tx.auditLog.findMany({
      where: { action: "USER_LOGIN", createdAt: { gte: from, lte: to } },
      orderBy: { id: "desc" },
      take: 6,
      select: auditRecordSelect,
    });

    const recentEventRecords = await tx.auditLog.findMany({
      where: {
        // 登录/登出放在「最近登录」里，这里保留失败、重置密码等值得注意的事件
        action: { notIn: [...ROUTINE_AUTH_ACTIONS] },
        createdAt: { gte: from, lte: to },
      },
      orderBy: { id: "desc" },
      take: 8,
      select: auditRecordSelect,
    });

    const topPeople = await tx.auditLog.groupBy({
      by: ["actorId"],
      where: {
        actorId: { not: null },
        createdAt: { gte: from, lte: to },
        // 「最活跃」按业务操作排，不把纯登录算成干活
        action: { notIn: NON_ACTIVITY_ACTIONS },
      },
      _count: { actorId: true },
      _max: { createdAt: true },
      orderBy: { _count: { actorId: "desc" } },
      take: 5,
    });

    const failureGroups = await tx.$queryRaw<
      Array<{ email: string | null; count: number }>
    >`
      SELECT metadata->>'email' AS email, COUNT(*)::int AS count
      FROM "AuditLog"
      WHERE action = 'USER_LOGIN_FAILED'
        AND "createdAt" >= ${from} AND "createdAt" <= ${to}
      GROUP BY 1
      ORDER BY 2 DESC
      LIMIT 5
    `;

    const multiIp = await tx.$queryRaw<
      Array<{ actorId: string; ipCount: number }>
    >`
      SELECT "actorId", COUNT(DISTINCT "ipAddress")::int AS "ipCount"
      FROM "AuditLog"
      WHERE action = 'USER_LOGIN'
        AND "actorId" IS NOT NULL
        AND "ipAddress" IS NOT NULL
        AND "createdAt" >= ${from} AND "createdAt" <= ${to}
      GROUP BY 1
      HAVING COUNT(DISTINCT "ipAddress") > 1
      ORDER BY 2 DESC
      LIMIT 5
    `;

    const references = await loadAuditReferences(tx, [
      ...recentLoginRecords,
      ...recentEventRecords,
    ]);

    const lastActivityByUser = new Map<string, Date>();
    for (const row of lastActivityRows) {
      if (row.actorId && row._max.createdAt) {
        lastActivityByUser.set(row.actorId, row._max.createdAt);
      }
    }

    const sessions = buildAuditSessions(authEvents, {
      now,
      to,
      lastActivityByUser,
      liveSessions,
    });
    // 跨区间起止的会话按交集计入，时长只算区间内的那一段
    const rangeSessions = sessionMetricsWithinRange(sessions, from, to, now);

    const trendByDate = new Map(trendRows.map((row) => [row.date, row]));
    const trend = eachShanghaiDay(from, to).map((date) => {
      const row = trendByDate.get(date);
      return {
        date,
        actions: Number(row?.actions ?? 0),
        activePeople: Number(row?.activePeople ?? 0),
        logins: Number(row?.logins ?? 0),
      };
    });

    const totals = totalsRows[0] ?? {
      actionCount: 0,
      activePeople: 0,
      loginCount: 0,
      failedLoginCount: 0,
    };

    const topUserIds = topPeople
      .map((row) => row.actorId)
      .filter((id): id is string => Boolean(id));
    const topUsers = topUserIds.length
      ? await tx.user.findMany({
          where: { id: { in: topUserIds } },
          select: {
            id: true,
            name: true,
            email: true,
            platformRole: true,
            roleGroup: { select: { name: true } },
          },
        })
      : [];
    const topUserById = new Map(topUsers.map((user) => [user.id, user]));

    const multiIpUserIds = multiIp.map((row) => row.actorId);
    const multiIpUsers = multiIpUserIds.length
      ? await tx.user.findMany({
          where: { id: { in: multiIpUserIds } },
          select: { id: true, name: true },
        })
      : [];
    const multiIpNameById = new Map(multiIpUsers.map((user) => [user.id, user.name]));

    const notices: AuditOverview["notices"] = [];
    const failedCount = Number(totals.failedLoginCount);
    if (failedCount > 0) {
      const topFailure = failureGroups[0];
      const detail = topFailure?.email
        ? `其中 ${topFailure.email} 失败 ${Number(topFailure.count)} 次`
        : "请留意是否有账号被反复尝试";
      notices.push({
        key: "FAILED_LOGIN",
        tone: failedCount >= 5 ? "warning" : "info",
        title: `${failedCount} 次登录失败`,
        description: detail,
      });
    }
    if (multiIp.length > 0) {
      const names = multiIp
        .map((row) => multiIpNameById.get(row.actorId))
        .filter((name): name is string => Boolean(name));
      notices.push({
        key: "MULTI_IP",
        tone: "info",
        title: `${multiIp.length} 个账号在多个网络登录`,
        description: names.length
          ? `${names.slice(0, 3).join("、")}${names.length > 3 ? " 等" : ""} 在统计区间内使用过不同 IP，可能是换了网络或使用多台设备。`
          : "这些账号在统计区间内使用过不同 IP。",
      });
    }

    return {
      from: from.toISOString(),
      to: to.toISOString(),
      totals: {
        actionCount: Number(totals.actionCount),
        activePeople: Number(totals.activePeople),
        loginCount: Number(totals.loginCount),
        failedLoginCount: failedCount,
        sessionCount: rangeSessions.length,
        avgSessionMs: averageDuration(rangeSessions),
        onlineNow: new Set(liveSessions.map((session) => session.userId)).size,
      },
      trend,
      recentLogins: mapAuditRecords(recentLoginRecords, references),
      recentEvents: mapAuditRecords(recentEventRecords, references),
      topPeople: topPeople.flatMap((row) => {
        const user = row.actorId ? topUserById.get(row.actorId) : null;
        if (!user) return [];
        return [
          {
            id: user.id,
            name: user.name,
            email: user.email,
            roleLabel:
              user.roleGroup?.name ??
              platformRoleLabel(user.platformRole) ??
              "用户",
            actionCount: row._count.actorId,
            lastActiveAt: (row._max.createdAt ?? from).toISOString(),
          },
        ];
      }),
      onlineSessions: liveSessions.slice(0, 12).map((session) => ({
        sessionId: session.id,
        userId: session.userId,
        name: session.user.name,
        email: session.user.email,
        roleLabel:
          session.user.roleGroup?.name ??
          platformRoleLabel(session.user.platformRole) ??
          "用户",
        startedAt: session.createdAt.toISOString(),
        durationMs: Math.max(0, now.getTime() - session.createdAt.getTime()),
        ipAddress: session.ipAddress,
        device:
          session.client === "MINIAPP"
            ? { browser: null, os: null, deviceType: "小程序", label: "微信小程序" }
            : describeUserAgent(session.userAgent),
      })),
      notices,
    };
  });
}

export async function listAuditPeople(
  actor: Actor,
  params: {
    from: Date;
    to: Date;
    search?: string;
    role?: "STAFF" | "CUSTOMER";
    page?: number;
    pageSize?: number;
  },
  now = new Date(),
): Promise<AuditPeoplePage> {
  assertAllowed(actor.isPlatformAdmin);
  const { from, to } = params;
  const pageSize = Math.min(Math.max(params.pageSize ?? 25, 1), AUDIT_PAGE_SIZE_MAX);
  const page = Math.max(params.page ?? 0, 0);
  const search = params.search?.trim();

  return withActorDb(actor, async (tx) => {
    const users = await tx.user.findMany({
      where: {
        deletedAt: null,
        ...(params.role === "STAFF"
          ? { platformRole: { in: ["PLATFORM_ADMIN", "PROJECT_MANAGER", "TECHNICIAN"] } }
          : params.role === "CUSTOMER"
            ? { platformRole: "CUSTOMER" }
            : {}),
        ...(search
          ? {
              OR: [
                { name: { contains: search, mode: "insensitive" } },
                { email: { contains: search, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      select: {
        id: true,
        name: true,
        email: true,
        platformRole: true,
        roleGroup: { select: { name: true } },
      },
    });

    const activityRows = await tx.auditLog.groupBy({
      by: ["actorId"],
      where: { actorId: { not: null }, createdAt: { gte: from, lte: to } },
      _count: { actorId: true },
    });
    const lastActiveRows = await tx.auditLog.groupBy({
      by: ["actorId"],
      // 「最近操作」只算业务操作；只看登录/登出会把它误当成做过事
      where: {
        actorId: { not: null },
        action: { notIn: NON_ACTIVITY_ACTIONS },
      },
      _max: { createdAt: true },
    });
    // 估算会话结束时间只能用区间内的最后一次操作；全时间的最末操作只用于展示
    const rangeActivityRows = await tx.auditLog.groupBy({
      by: ["actorId"],
      where: {
        actorId: { not: null },
        createdAt: { gte: from, lte: to },
        action: { notIn: NON_ACTIVITY_ACTIONS },
      },
      _max: { createdAt: true },
    });
    // 最近登录的「时间 + 设备 + IP」必须来自同一条事件；独立聚合会拼出
    // 「历史区间的时间戳 + 更近一次登录的设备」这种错位信息。
    const userIds = users.map((user) => user.id);
    const latestLoginRows = userIds.length
      ? await tx.$queryRaw<
          Array<{
            actorId: string;
            createdAt: Date;
            ipAddress: string | null;
            userAgent: string | null;
          }>
        >`
          SELECT DISTINCT ON ("actorId")
            "actorId", "createdAt", "ipAddress", "userAgent"
          FROM "AuditLog"
          WHERE action = 'USER_LOGIN'
            AND "actorId" = ANY(${userIds}::text[])
          ORDER BY "actorId", "createdAt" DESC
        `
      : [];
    const latestLoginByUser = new Map(
      latestLoginRows.map((row) => [row.actorId, row]),
    );
    const authEvents = await loadAuthEventsForRange(tx, {
      from,
      to,
      now,
      requireActor: true,
    });
    const liveWebSessions = await tx.session.findMany({
      where: { expiresAt: { gt: now } },
      select: {
        id: true,
        userId: true,
        createdAt: true,
        expiresAt: true,
        ipAddress: true,
        userAgent: true,
      },
    });
    const liveMiniappSessions = await tx.miniappSession.findMany({
      where: { expiresAt: { gt: now }, revokedAt: null },
      select: { id: true, userId: true, createdAt: true, expiresAt: true },
    });
    const liveSessions = [
      ...liveWebSessions.map((session) => ({ ...session, client: "WEB" as const })),
      ...liveMiniappSessions.map((session) => ({
        ...session,
        ipAddress: null,
        userAgent: null,
        client: "MINIAPP" as const,
      })),
    ];

    const activityByUser = new Map(
      activityRows.flatMap((row) =>
        row.actorId ? [[row.actorId, row._count.actorId] as const] : [],
      ),
    );
    const lastActiveByUser = new Map(
      lastActiveRows.flatMap((row) =>
        row.actorId && row._max.createdAt
          ? [[row.actorId, row._max.createdAt] as const]
          : [],
      ),
    );
    const lastActivityForDuration = new Map<string, Date>();
    for (const row of rangeActivityRows) {
      if (row.actorId && row._max.createdAt) {
        lastActivityForDuration.set(row.actorId, row._max.createdAt);
      }
    }

    const sessions = buildAuditSessions(authEvents, {
      now,
      to,
      lastActivityByUser: lastActivityForDuration,
      liveSessions,
    });

    const durationByUser = new Map<
      string,
      {
        total: number;
        measuredTotal: number;
        measured: number;
        estimatedTotal: number;
        estimatedCount: number;
        count: number;
      }
    >();
    for (const session of sessions) {
      if (!sessionOverlapsRange(session, from, to, now)) continue;
      const entry =
        durationByUser.get(session.userId) ??
        {
          total: 0,
          measuredTotal: 0,
          measured: 0,
          estimatedTotal: 0,
          estimatedCount: 0,
          count: 0,
        };
      entry.count += 1;
      const durationMs = sessionDurationWithinRange(session, from, to, now);
      if (durationMs !== null) {
        // 累计只算「已登出 / 仍登录」；未登出的估算值不进合计，避免 12 天假会话
        if (session.endReason === "LOGGED_OUT" || session.endReason === "ACTIVE") {
          entry.total += durationMs;
        }
        if (session.endReason === "LOGGED_OUT") {
          entry.measuredTotal += durationMs;
          entry.measured += 1;
        }
        if (session.endReason === "STALE") {
          entry.estimatedTotal += durationMs;
          entry.estimatedCount += 1;
        }
      }
      durationByUser.set(session.userId, entry);
    }

    const liveUserIds = new Set(liveSessions.map((session) => session.userId));

    const rows: AuditPersonActivityRow[] = users.map((user) => {
      const duration = durationByUser.get(user.id);
      return {
        id: user.id,
        name: user.name,
        email: user.email,
        roleLabel:
          user.roleGroup?.name ?? platformRoleLabel(user.platformRole) ?? "用户",
        kind: "USER",
        isOnline: liveUserIds.has(user.id),
        lastActiveAt: lastActiveByUser.get(user.id)?.toISOString() ?? null,
        lastLoginAt: latestLoginByUser.get(user.id)?.createdAt.toISOString() ?? null,
        loginCount: 0,
        actionCount: activityByUser.get(user.id) ?? 0,
        sessionCount: duration?.count ?? 0,
        totalDurationMs: duration?.total ?? 0,
        estimatedDurationMs: duration?.estimatedTotal ?? 0,
        avgDurationMs:
          duration && duration.measured > 0
            ? Math.round(duration.measuredTotal / duration.measured)
            : null,
        lastIpAddress: latestLoginByUser.get(user.id)?.ipAddress ?? null,
        lastDevice: latestLoginByUser.get(user.id)?.userAgent
          ? describeUserAgent(latestLoginByUser.get(user.id)?.userAgent)
          : null,
      };
    });

    // 登录次数按区间统计；放在这里一次性算，避免每行再查库
    const loginCountByUser = new Map<string, number>();
    for (const event of authEvents) {
      if (
        event.action !== "USER_LOGIN" ||
        !event.actorId ||
        !isCredentialLogin(event.metadata) ||
        event.createdAt.getTime() < from.getTime() ||
        event.createdAt.getTime() > to.getTime()
      ) {
        continue;
      }
      loginCountByUser.set(event.actorId, (loginCountByUser.get(event.actorId) ?? 0) + 1);
    }
    for (const row of rows) {
      row.loginCount = loginCountByUser.get(row.id) ?? 0;
    }

    rows.sort((left, right) => {
      if (left.isOnline !== right.isOnline) return left.isOnline ? -1 : 1;
      const leftTime = left.lastActiveAt ? new Date(left.lastActiveAt).getTime() : 0;
      const rightTime = right.lastActiveAt ? new Date(right.lastActiveAt).getTime() : 0;
      if (leftTime !== rightTime) return rightTime - leftTime;
      return left.name.localeCompare(right.name, "zh-CN");
    });

    return {
      rows: rows.slice(page * pageSize, page * pageSize + pageSize),
      total: rows.length,
      activeWindowDays: eachShanghaiDay(from, to).length,
    };
  });
}

export async function getAuditPersonDetail(
  actor: Actor,
  userId: string,
  params: {
    from: Date;
    to: Date;
    page?: number;
    pageSize?: number;
    category?: AuditCategoryKey;
  },
  now = new Date(),
): Promise<AuditPersonDetail | null> {
  assertAllowed(actor.isPlatformAdmin);
  const { from, to } = params;
  const pageSize = Math.min(Math.max(params.pageSize ?? 25, 1), AUDIT_PAGE_SIZE_MAX);
  const page = Math.max(params.page ?? 0, 0);

  return withActorDb(actor, async (tx) => {
    const user = await tx.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: {
        id: true,
        name: true,
        email: true,
        platformRole: true,
        roleGroup: { select: { name: true } },
      },
    });
    if (!user) return null;

    const categoryWhere = params.category
      ? await auditCategoryWhereForDb(tx, params.category)
      : {};
    const actionGroups = await tx.auditLog.groupBy({
      by: ["action"],
      where: { actorId: userId, createdAt: { gte: from, lte: to } },
      _count: { _all: true },
    });
    const timelineTotal = await tx.auditLog.count({
      where: {
        actorId: userId,
        createdAt: { gte: from, lte: to },
        ...categoryWhere,
      },
    });
    const actionCount = actionGroups.reduce(
      (sum, group) => sum + group._count._all,
      0,
    );
    const timelineRecords = await tx.auditLog.findMany({
      where: {
        actorId: userId,
        createdAt: { gte: from, lte: to },
        ...categoryWhere,
      },
      orderBy: { id: "desc" },
      skip: page * pageSize,
      take: pageSize,
      select: auditRecordSelect,
    });
    const authEvents = await loadAuthEventsForRange(tx, {
      from,
      to,
      now,
      actorId: userId,
    });
    const liveWebSessions = await tx.session.findMany({
      where: { userId, expiresAt: { gt: now } },
      select: {
        id: true,
        userId: true,
        createdAt: true,
        expiresAt: true,
        ipAddress: true,
        userAgent: true,
      },
      orderBy: { createdAt: "desc" },
    });
    const liveMiniappSessions = await tx.miniappSession.findMany({
      where: { userId, expiresAt: { gt: now }, revokedAt: null },
      select: { id: true, userId: true, createdAt: true, expiresAt: true },
      orderBy: { createdAt: "desc" },
    });
    const liveSessions = [
      ...liveWebSessions.map((session) => ({ ...session, client: "WEB" as const })),
      ...liveMiniappSessions.map((session) => ({
        ...session,
        ipAddress: null,
        userAgent: null,
        client: "MINIAPP" as const,
      })),
    ];
    const lastActive = await tx.auditLog.aggregate({
      where: { actorId: userId, action: { notIn: NON_ACTIVITY_ACTIONS } },
      _max: { createdAt: true },
    });
    const lastLogin = await tx.auditLog.aggregate({
      where: { actorId: userId, action: "USER_LOGIN" },
      _max: { createdAt: true },
    });

    const references = await loadAuditReferences(tx, timelineRecords);
    const lastActivityRows = await tx.auditLog.groupBy({
      by: ["actorId"],
      where: {
        actorId: userId,
        createdAt: { gte: from, lte: to },
        action: { notIn: NON_ACTIVITY_ACTIONS },
      },
      _max: { createdAt: true },
    });
    const lastBusinessActivity = lastActivityRows[0]?._max.createdAt ?? null;

    const sessions = buildAuditSessions(authEvents, {
      now,
      to,
      lastActivityByUser: new Map(
        lastBusinessActivity ? [[userId, lastBusinessActivity]] : [],
      ),
      liveSessions,
    });
    const rangeSessions = sessionMetricsWithinRange(sessions, from, to, now);

    const breakdownMap = new Map<AuditCategoryKey, number>();
    for (const group of actionGroups) {
      const category = auditCategoryFor(group.action);
      breakdownMap.set(
        category,
        (breakdownMap.get(category) ?? 0) + group._count._all,
      );
    }

    const totalDurationMs = rangeSessions.reduce(
      (sum, item) =>
        (item.session.endReason === "LOGGED_OUT" ||
          item.session.endReason === "ACTIVE") &&
        item.durationMs !== null
          ? sum + item.durationMs
          : sum,
      0,
    );
    const measuredSessions = rangeSessions.filter(
      (item) =>
        item.session.endReason === "LOGGED_OUT" && item.durationMs !== null,
    );
    const measuredDurationMs = measuredSessions.reduce(
      (sum, item) => sum + (item.durationMs ?? 0),
      0,
    );
    const estimatedDurationMs = rangeSessions.reduce(
      (sum, item) =>
        item.session.endReason === "STALE" && item.durationMs !== null
          ? sum + item.durationMs
          : sum,
      0,
    );

    return {
      person: {
        id: user.id,
        name: user.name,
        email: user.email,
        roleLabel:
          user.roleGroup?.name ?? platformRoleLabel(user.platformRole) ?? "用户",
        isOnline: liveSessions.length > 0,
        lastActiveAt: lastActive._max.createdAt?.toISOString() ?? null,
        lastLoginAt: lastLogin._max.createdAt?.toISOString() ?? null,
      },
      from: from.toISOString(),
      to: to.toISOString(),
      totals: {
        actionCount,
        loginCount: authEvents.filter(
          (event) =>
            event.action === "USER_LOGIN" &&
            isCredentialLogin(event.metadata) &&
            event.createdAt.getTime() >= from.getTime() &&
            event.createdAt.getTime() <= to.getTime(),
        ).length,
        sessionCount: rangeSessions.length,
        totalDurationMs,
        estimatedDurationMs,
        avgDurationMs:
          measuredSessions.length > 0
            ? Math.round(measuredDurationMs / measuredSessions.length)
            : null,
      },
      currentSessions: liveSessions.map((session) => ({
        sessionId: session.id,
        startedAt: session.createdAt.toISOString(),
        durationMs: Math.max(0, now.getTime() - session.createdAt.getTime()),
        expiresAt: session.expiresAt.toISOString(),
        ipAddress: session.ipAddress,
        device:
          session.client === "MINIAPP"
            ? { browser: null, os: null, deviceType: "小程序", label: "微信小程序" }
            : describeUserAgent(session.userAgent),
      })),
      sessions: toSessionViews(rangeSessions.map((item) => item.session)),
      breakdown: [...breakdownMap.entries()]
        .map(([category, count]) => ({
          category,
          categoryLabel: auditCategoryLabel(category),
          count,
        }))
        .sort((left, right) => right.count - left.count),
      timeline: {
        rows: mapAuditRecords(timelineRecords, references),
        total: timelineTotal,
        page,
        pageSize,
      },
    };
  });
}
