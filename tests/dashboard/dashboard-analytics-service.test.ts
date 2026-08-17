import { afterEach, describe, expect, it, vi } from "vitest";
import type { Actor } from "@/lib/actor";

const queryRawMock = vi.hoisted(() =>
  vi.fn((strings: TemplateStringsArray) => {
    const query = strings.join(" ");
    if (query.includes("DATE(\"createdAt\")")) {
      return Promise.resolve([
        { currentDate: "2026-08-14", date: "2026-07-16", count: 2 },
        { currentDate: "2026-08-14", date: "2026-08-14", count: 5 },
      ]);
    }
    return Promise.resolve([
      { priority: "HIGH", avgMinutes: 15.5, count: 2 },
      { priority: "URGENT", avgMinutes: 4, count: 1 },
    ]);
  }),
);
const groupByMock = vi.hoisted(() =>
  vi.fn().mockResolvedValue([
    { status: "PENDING", _count: { _all: 3 } },
    { status: "RESOLVED", _count: { _all: 1 } },
  ]),
);
const countMock = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("@/lib/actor", () => ({
  withActorDb: (_actor: Actor, callback: (tx: unknown) => unknown) =>
    callback({
      $queryRaw: queryRawMock,
      serviceRequest: { groupBy: groupByMock, count: countMock },
    }),
}));

import {
  getDashboardAnalytics,
  getDashboardSlaSummary,
} from "@/modules/dashboard/dashboard-analytics-service";

const staff: Actor = {
  id: "staff-1",
  name: "后台人员",
  email: "staff@example.test",
  platformRole: "TECHNICIAN",
  isPlatformAdmin: false,
  isStaff: true,
};

afterEach(() => {
  vi.clearAllMocks();
});

describe("后台 Dashboard 分析", () => {
  it("返回连续 30 天、完整状态和有样本的优先级", async () => {
    const result = await getDashboardAnalytics(staff);

    expect(result.volumeTrend).toHaveLength(30);
    expect(result.volumeTrend[0]).toEqual({ date: "2026-07-16", count: 2 });
    expect(result.volumeTrend[1]).toEqual({ date: "2026-07-17", count: 0 });
    expect(result.volumeTrend.at(-1)).toEqual({
      date: "2026-08-14",
      count: 5,
    });
    expect(result.statusDistribution).toEqual([
      { status: "PENDING", count: 3 },
      { status: "IN_PROGRESS", count: 0 },
      { status: "WAITING_CUSTOMER", count: 0 },
      { status: "RESOLVED", count: 1 },
      { status: "CLOSED", count: 0 },
    ]);
    expect(result.responseTimeByPriority).toEqual([
      { priority: "HIGH", avgMinutes: 15.5, count: 2 },
      { priority: "URGENT", avgMinutes: 4, count: 1 },
    ]);
    expect(groupByMock).toHaveBeenCalledWith({
      by: ["status"],
      _count: { _all: true },
      where: { archivedAt: null },
    });
  });

  it("拒绝客户账号访问后台分析", async () => {
    await expect(
      getDashboardAnalytics({
        ...staff,
        platformRole: "CUSTOMER",
        isStaff: false,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
    expect(queryRawMock).not.toHaveBeenCalled();
    expect(groupByMock).not.toHaveBeenCalled();
  });

  it("在 Actor 数据库上下文中统计 SLA 超时和临近数量", async () => {
    countMock.mockResolvedValueOnce(2).mockResolvedValueOnce(1);
    const now = new Date("2026-08-14T08:00:00.000Z");

    await expect(getDashboardSlaSummary(staff, now)).resolves.toEqual({
      breached: 2,
      atRisk: 1,
    });
    expect(countMock).toHaveBeenNthCalledWith(1, {
      where: {
        dueAt: { lt: now, not: null },
        status: { in: ["PENDING", "IN_PROGRESS", "WAITING_CUSTOMER"] },
      },
    });
    expect(countMock).toHaveBeenNthCalledWith(2, {
      where: {
        dueAt: {
          gte: now,
          lt: new Date("2026-08-14T09:00:00.000Z"),
        },
        status: { in: ["PENDING", "IN_PROGRESS", "WAITING_CUSTOMER"] },
      },
    });
  });
});
