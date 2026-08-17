import "server-only";

import { eachDayOfInterval, format, parseISO, subDays } from "date-fns";
import type {
  RequestPriority,
  RequestStatus,
} from "@/generated/prisma/client";
import type { Actor } from "@/lib/actor";
import { withActorDb } from "@/lib/actor";
import { assertAllowed } from "@/modules/projects/errors";

const REQUEST_STATUSES: RequestStatus[] = [
  "PENDING",
  "IN_PROGRESS",
  "WAITING_CUSTOMER",
  "RESOLVED",
  "CLOSED",
];

const REQUEST_PRIORITIES: RequestPriority[] = [
  "LOW",
  "NORMAL",
  "HIGH",
  "URGENT",
];

type VolumeRow = {
  currentDate: string;
  date: string | null;
  count: number | null;
};

type ResponseTimeRow = {
  priority: RequestPriority;
  avgMinutes: number;
  count: number;
};

export interface DashboardAnalytics {
  volumeTrend: Array<{ date: string; count: number }>;
  statusDistribution: Array<{ status: RequestStatus; count: number }>;
  responseTimeByPriority: Array<{
    priority: RequestPriority;
    avgMinutes: number;
    count: number;
  }>;
}

export type DashboardSlaSummary = {
  breached: number;
  atRisk: number;
};

export async function getDashboardAnalytics(
  actor: Actor,
): Promise<DashboardAnalytics> {
  assertAllowed(actor.isStaff);

  return withActorDb(actor, async (tx) => {
    const volumeRows = await tx.$queryRaw<VolumeRow[]>`
        WITH daily AS (
          SELECT
            DATE("createdAt")::text AS date,
            COUNT(*)::int AS count
          FROM "ServiceRequest"
          WHERE "createdAt" >= CURRENT_DATE - INTERVAL '29 days'
          GROUP BY DATE("createdAt")
        )
        SELECT
          CURRENT_DATE::text AS "currentDate",
          daily.date,
          daily.count
        FROM (SELECT 1) AS anchor
        LEFT JOIN daily ON true
        ORDER BY daily.date ASC
      `;
    const statusRows = await tx.serviceRequest.groupBy({
      by: ["status"],
      _count: { _all: true },
      where: { archivedAt: null },
    });
    const responseTimeRows = await tx.$queryRaw<ResponseTimeRow[]>`
        SELECT
          priority,
          AVG(
            EXTRACT(EPOCH FROM ("firstRespondedAt" - "createdAt")) / 60
          )::float AS "avgMinutes",
          COUNT(*)::int AS count
        FROM "ServiceRequest"
        WHERE "firstRespondedAt" IS NOT NULL
          AND "createdAt" >= CURRENT_DATE - INTERVAL '29 days'
        GROUP BY priority
      `;

    const currentDate = parseISO(
      volumeRows[0]?.currentDate ?? format(new Date(), "yyyy-MM-dd"),
    );
    const volumeByDate = new Map(
      volumeRows.flatMap((row) =>
        row.date ? [[row.date, Number(row.count ?? 0)] as const] : [],
      ),
    );
    const statusCountByStatus = new Map(
      statusRows.map((row) => [row.status, row._count._all]),
    );
    const responseTimeByPriority = new Map(
      responseTimeRows.map((row) => [row.priority, row]),
    );

    return {
      volumeTrend: eachDayOfInterval({
        start: subDays(currentDate, 29),
        end: currentDate,
      }).map((date) => {
        const key = format(date, "yyyy-MM-dd");
        return { date: key, count: volumeByDate.get(key) ?? 0 };
      }),
      statusDistribution: REQUEST_STATUSES.map((status) => ({
        status,
        count: statusCountByStatus.get(status) ?? 0,
      })),
      responseTimeByPriority: REQUEST_PRIORITIES.flatMap((priority) => {
        const row = responseTimeByPriority.get(priority);
        return row
          ? [
              {
                priority,
                avgMinutes: Number(row.avgMinutes),
                count: Number(row.count),
              },
            ]
          : [];
      }),
    };
  });
}

export async function getDashboardSlaSummary(
  actor: Actor,
  now = new Date(),
): Promise<DashboardSlaSummary> {
  assertAllowed(actor.isStaff);
  const oneHourFromNow = new Date(now.getTime() + 3_600_000);
  const openStatuses: RequestStatus[] = [
    "PENDING",
    "IN_PROGRESS",
    "WAITING_CUSTOMER",
  ];

  return withActorDb(actor, async (tx) => {
    const breached = await tx.serviceRequest.count({
      where: {
        dueAt: { lt: now, not: null },
        status: { in: openStatuses },
      },
    });
    const atRisk = await tx.serviceRequest.count({
      where: {
        dueAt: { gte: now, lt: oneHourFromNow },
        status: { in: openStatuses },
      },
    });
    return { breached, atRisk };
  });
}
