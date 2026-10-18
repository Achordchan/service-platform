import { describe, expect, it } from "vitest";
import {
  buildAuditSessions,
  sessionDurationWithinRange,
  sessionOverlapsRange,
  toSessionViews,
  type AuditAuthEvent,
  type AuditLiveSession,
  type BuiltSession,
} from "@/modules/audit/audit-sessions";

const base = new Date("2026-10-18T01:00:00.000Z"); // 北京时间 09:00

function at(minutes: number) {
  return new Date(base.getTime() + minutes * 60_000);
}

let nextId = 1n;

function event(input: {
  action: "USER_LOGIN" | "USER_LOGOUT";
  minutes: number;
  userId?: string;
  sessionId?: string;
  ipAddress?: string | null;
  userAgent?: string | null;
  path?: string;
}): AuditAuthEvent {
  return {
    id: nextId++,
    action: input.action,
    actorId: input.userId ?? "u1",
    createdAt: at(input.minutes),
    ipAddress: input.ipAddress ?? "203.0.113.10",
    userAgent: input.userAgent ?? "Mozilla/5.0 Chrome/138.0",
    metadata: {
      ...(input.path ? { path: input.path } : {}),
      ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    },
  };
}

function live(input: {
  id: string;
  userId?: string;
  minutes: number;
  ipAddress?: string | null;
  userAgent?: string | null;
  client?: "WEB" | "MINIAPP";
}): AuditLiveSession {
  return {
    id: input.id,
    userId: input.userId ?? "u1",
    createdAt: at(input.minutes),
    expiresAt: at(input.minutes + 60 * 24 * 7),
    ipAddress: input.ipAddress ?? "203.0.113.10",
    userAgent: input.userAgent ?? "Mozilla/5.0 Chrome/138.0",
    client: input.client ?? "WEB",
  };
}

const now = at(240);
const to = at(240);

describe("登录会话配对", () => {
  it("优先按 sessionId 精确配对，算出登录到登出的跨度", () => {
    const sessions = buildAuditSessions(
      [
        event({ action: "USER_LOGIN", minutes: 0, sessionId: "s1" }),
        event({ action: "USER_LOGOUT", minutes: 42, sessionId: "s1" }),
      ],
      { now, to },
    );
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      key: "s1",
      endReason: "LOGGED_OUT",
      durationMs: 42 * 60_000,
    });
    expect(sessions[0]?.endedAt?.toISOString()).toBe(at(42).toISOString());
  });

  it("没有 sessionId 的旧数据按 IP/UA 配对，并明确标为正常登出", () => {
    const sessions = buildAuditSessions(
      [
        event({ action: "USER_LOGIN", minutes: 0 }),
        event({ action: "USER_LOGOUT", minutes: 15 }),
      ],
      { now, to },
    );
    expect(sessions[0]).toMatchObject({ endReason: "LOGGED_OUT", durationMs: 15 * 60_000 });
  });

  it("同时存在多个会话时，登出只关闭对应 sessionId 的那一个", () => {
    const sessions = buildAuditSessions(
      [
        event({ action: "USER_LOGIN", minutes: 0, sessionId: "s1", userAgent: "A" }),
        event({
          action: "USER_LOGIN",
          minutes: 5,
          sessionId: "s2",
          userAgent: "B",
          ipAddress: "198.51.100.7",
        }),
        event({ action: "USER_LOGOUT", minutes: 30, sessionId: "s1", userAgent: "A" }),
      ],
      { now, to },
    );
    const closed = sessions.find((session) => session.key === "s1");
    const open = sessions.find((session) => session.key === "s2");
    expect(closed?.endReason).toBe("LOGGED_OUT");
    expect(closed?.durationMs).toBe(30 * 60_000);
    expect(open?.endReason).toBe("UNKNOWN");
    expect(open?.durationMs).toBeNull();
  });

  it("带 sessionId 的登出配不上时忽略，不会误关并发的另一段会话", () => {
    const sessions = buildAuditSessions(
      [
        event({ action: "USER_LOGIN", minutes: 0, sessionId: "s1" }),
        event({ action: "USER_LOGOUT", minutes: 10, sessionId: "s-other" }),
      ],
      { now, to },
    );
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({ key: "s1", endReason: "UNKNOWN" });
  });

  it("登出带 sessionStartedAt、登录在窗口外时，能补出完整会话", () => {
    const sessions = buildAuditSessions(
      [
        {
          id: nextId++,
          action: "USER_LOGOUT",
          actorId: "u1",
          createdAt: at(60),
          ipAddress: "203.0.113.10",
          userAgent: "Mozilla/5.0 Chrome/138.0",
          metadata: {
            sessionId: "s-old",
            sessionStartedAt: at(0).toISOString(),
          },
        },
      ],
      { now, to },
    );
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      key: "s-old",
      endReason: "LOGGED_OUT",
      durationMs: 60 * 60_000,
    });
    expect(sessions[0]?.startedAt.toISOString()).toBe(at(0).toISOString());
  });

  it("部署前登录、部署后登出：回退到唯一的无 sessionId 登录", () => {
    const sessions = buildAuditSessions(
      [
        // 旧登录没有 sessionId
        event({ action: "USER_LOGIN", minutes: 0 }),
        // 新登出带 sessionId，精确匹配不到，应回退到唯一的旧登录
        event({ action: "USER_LOGOUT", minutes: 20, sessionId: "s-new" }),
      ],
      { now, to },
    );
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      endReason: "LOGGED_OUT",
      durationMs: 20 * 60_000,
    });
  });

  it("旧小程序登录没有 sessionId 时，按同人 + 时间匹配 live 会话", () => {
    const sessions = buildAuditSessions(
      [event({ action: "USER_LOGIN", minutes: 0, path: "miniapp" })],
      {
        now,
        to,
        liveSessions: [
          {
            id: "m-live",
            userId: "u1",
            createdAt: at(0),
            expiresAt: at(60 * 24 * 30),
            ipAddress: null,
            userAgent: null,
            client: "MINIAPP",
          },
        ],
      },
    );
    expect(sessions[0]).toMatchObject({ endReason: "ACTIVE" });
  });

  it("旧 Web 登录与会话行 IP 不一致但 UA 一致时仍能识别为登录中", () => {
    const sessions = buildAuditSessions(
      [event({ action: "USER_LOGIN", minutes: 0, ipAddress: "203.0.113.10" })],
      {
        now,
        to,
        liveSessions: [
          {
            id: "w-live",
            userId: "u1",
            createdAt: at(0),
            expiresAt: at(60 * 24 * 7),
            ipAddress: "10.0.0.2",
            userAgent: "Mozilla/5.0 Chrome/138.0",
            client: "WEB",
          },
        ],
      },
    );
    expect(sessions[0]).toMatchObject({ endReason: "ACTIVE" });
  });

  it("旧登录已登出、随后新建 live 会话时，不会因为时间相近而漏掉新会话", () => {
    const sessions = buildAuditSessions(
      [
        event({ action: "USER_LOGIN", minutes: 0 }),
        event({ action: "USER_LOGOUT", minutes: 1 }),
      ],
      {
        now,
        to,
        liveSessions: [
          {
            id: "replacement",
            userId: "u1",
            createdAt: at(2),
            expiresAt: at(60 * 24 * 7),
            ipAddress: "203.0.113.10",
            userAgent: "Mozilla/5.0 Chrome/138.0",
            client: "WEB",
          },
        ],
      },
    );
    expect(sessions).toHaveLength(2);
    expect(sessions.filter((item) => item.endReason === "LOGGED_OUT")).toHaveLength(1);
    expect(
      sessions.find((item) => item.endReason === "ACTIVE")?.key,
    ).toBe("replacement");
  });

  it("同一段 live session 不会被两个旧登录同时认领", () => {
    const sessions = buildAuditSessions(
      [
        event({ action: "USER_LOGIN", minutes: 0 }),
        event({ action: "USER_LOGIN", minutes: 1 }),
      ],
      {
        now,
        to,
        liveSessions: [live({ id: "only-live", minutes: 0 })],
      },
    );
    expect(sessions.filter((item) => item.endReason === "ACTIVE")).toHaveLength(1);
    expect(sessions.filter((item) => item.endReason === "UNKNOWN")).toHaveLength(1);
  });

  it("旧登录有多个同 IP/UA 候选时，不拿后续登出硬配", () => {
    const sessions = buildAuditSessions(
      [
        event({ action: "USER_LOGIN", minutes: 0 }),
        event({ action: "USER_LOGIN", minutes: 24 * 60 }),
        event({ action: "USER_LOGOUT", minutes: 24 * 60 + 1 }),
      ],
      { now: at(3 * 24 * 60), to: at(3 * 24 * 60) },
    );
    expect(sessions.some((item) => item.endReason === "LOGGED_OUT")).toBe(false);
  });

  it("估算旧会话结束时间时，不会跨过下一次登录", () => {
    const sessions = buildAuditSessions(
      [
        event({ action: "USER_LOGIN", minutes: 0 }),
        event({ action: "USER_LOGIN", minutes: 30 }),
      ],
      {
        now,
        to,
        lastActivityByUser: new Map([["u1", at(120)]]),
      },
    );
    const first = sessions.find((item) => item.startedAt.getTime() === at(0).getTime());
    const second = sessions.find((item) => item.startedAt.getTime() === at(30).getTime());
    expect(first).toMatchObject({ endReason: "STALE", durationMs: 30 * 60_000 });
    expect(second).toMatchObject({ endReason: "STALE", durationMs: 90 * 60_000 });
  });

  it("滚动发布时优先保留新登录的精确 sessionId，旧登录不能抢走", () => {
    const sessions = buildAuditSessions(
      [
        event({ action: "USER_LOGIN", minutes: 0 }),
        event({ action: "USER_LOGIN", minutes: 1, sessionId: "s-live" }),
      ],
      {
        now,
        to,
        liveSessions: [live({ id: "s-live", minutes: 1 })],
      },
    );
    expect(
      sessions.find((item) => item.key === "s-live")?.endReason,
    ).toBe("ACTIVE");
    expect(
      sessions.find((item) => item.key.startsWith("login-"))?.endReason,
    ).toBe("UNKNOWN");
  });

  it("旧 Web 登录不会认领同时间的小程序 live session", () => {
    const sessions = buildAuditSessions(
      [
        event({ action: "USER_LOGIN", minutes: 0 }),
        event({ action: "USER_LOGIN", minutes: 1, path: "miniapp" }),
      ],
      {
        now,
        to,
        liveSessions: [
          live({
            id: "m-live",
            minutes: 1,
            ipAddress: null,
            userAgent: null,
            client: "MINIAPP",
          }),
        ],
      },
    );
    expect(sessions.filter((item) => item.endReason === "ACTIVE")).toHaveLength(1);
    expect(
      sessions.find((item) => item.endReason === "ACTIVE")?.loginMethod,
    ).toBe("小程序登录");
    expect(sessions.filter((item) => item.endReason === "UNKNOWN")).toHaveLength(1);
  });

  it("没有登录事件的 live session 也能补成「登录中」", () => {
    const sessions = buildAuditSessions([], {
      now,
      to,
      liveSessions: [live({ id: "s-live", minutes: 0 })],
    });
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      key: "s-live",
      endReason: "ACTIVE",
      durationMs: 240 * 60_000,
    });
  });

  it("历史区间不会补入区间之后创建的 live session", () => {
    const sessions = buildAuditSessions([], {
      now: at(240),
      to: at(60),
      liveSessions: [live({ id: "s-future", minutes: 120 })],
    });
    expect(sessions).toHaveLength(0);
  });

  it("仍在登录的会话只算到当前时间，并标记 ACTIVE", () => {
    const sessions = buildAuditSessions(
      [event({ action: "USER_LOGIN", minutes: 60, sessionId: "s1" })],
      { now, to, liveSessions: [live({ id: "s1", minutes: 60 })] },
    );
    expect(sessions[0]).toMatchObject({ endReason: "ACTIVE", durationMs: 180 * 60_000 });
  });

  it("有 sessionId 的登录不会按 IP/UA 误配到另一段 live 会话", () => {
    const sessions = buildAuditSessions(
      [event({ action: "USER_LOGIN", minutes: 0, sessionId: "s-new" })],
      {
        now,
        to,
        liveSessions: [
          {
            id: "s-old",
            userId: "u1",
            createdAt: at(0),
            expiresAt: at(60 * 24 * 7),
            ipAddress: "203.0.113.10",
            userAgent: "Mozilla/5.0 Chrome/138.0",
            client: "WEB",
          },
        ],
      },
    );
    expect(sessions[0]).toMatchObject({ key: "s-new", endReason: "UNKNOWN" });
  });

  it("没有登出但有后续操作时，按最后操作估算并标记 STALE", () => {
    const sessions = buildAuditSessions(
      [event({ action: "USER_LOGIN", minutes: 0, sessionId: "s1" })],
      {
        now,
        to,
        lastActivityByUser: new Map([["u1", at(25)]]),
      },
    );
    expect(sessions[0]).toMatchObject({ endReason: "STALE", durationMs: 25 * 60_000 });
  });

  it("没有登出也没有后续操作时，不伪造时长", () => {
    const sessions = buildAuditSessions(
      [event({ action: "USER_LOGIN", minutes: 0, sessionId: "s1" })],
      { now, to },
    );
    expect(sessions[0]).toMatchObject({
      endReason: "UNKNOWN",
      durationMs: null,
      endedAt: null,
    });
  });

  it("乱序事件按时间排序，登出早于登录时不会配出负时长", () => {
    const sessions = buildAuditSessions(
      [
        event({ action: "USER_LOGOUT", minutes: 30, sessionId: "s1" }),
        event({ action: "USER_LOGIN", minutes: 0, sessionId: "s1" }),
      ],
      { now, to },
    );
    expect(sessions[0]?.durationMs).toBe(30 * 60_000);
  });

  it("登出事件先于任何登录（区间前开始的会话）时忽略，不生成幽灵会话", () => {
    const sessions = buildAuditSessions(
      [event({ action: "USER_LOGOUT", minutes: 10, sessionId: "s0" })],
      { now, to },
    );
    expect(sessions).toHaveLength(0);
  });

  it("小程序会话也能按 sessionId 精确匹配", () => {
    const sessions = buildAuditSessions(
      [event({ action: "USER_LOGIN", minutes: 0, sessionId: "m1", path: "miniapp" })],
      {
        now,
        to,
        liveSessions: [
          {
            id: "m1",
            userId: "u1",
            createdAt: at(0),
            expiresAt: at(60 * 24 * 30),
            ipAddress: null,
            userAgent: null,
            client: "MINIAPP",
          },
        ],
      },
    );
    expect(sessions[0]).toMatchObject({ endReason: "ACTIVE", loginMethod: "小程序登录" });
  });
});

describe("会话与统计区间", () => {
  const session = (input: Partial<BuiltSession>): BuiltSession => ({
    key: "s1",
    userId: "u1",
    startedAt: at(0),
    endedAt: at(60),
    durationMs: 60 * 60_000,
    endReason: "LOGGED_OUT",
    ipAddress: null,
    userAgent: null,
    loginMethod: null,
    ...input,
  });

  it("只统计与区间有交集的会话", () => {
    expect(sessionOverlapsRange(session({}), at(30), at(90))).toBe(true);
    expect(sessionOverlapsRange(session({}), at(61), at(90))).toBe(false);
    expect(sessionOverlapsRange(session({}), at(-30), at(-1))).toBe(false);
  });

  it("跨区间起止的会话只计入区间内那一段", () => {
    expect(sessionDurationWithinRange(session({}), at(30), at(90))).toBe(
      30 * 60_000,
    );
    expect(
      sessionDurationWithinRange(
        session({ startedAt: at(-60), endedAt: at(60), durationMs: 120 * 60_000 }),
        at(0),
        at(30),
      ),
    ).toBe(30 * 60_000);
  });

  it("UNKNOWN 会话计入存在性但不伪造时长", () => {
    const unknown = session({ endedAt: null, durationMs: null, endReason: "UNKNOWN" });
    expect(sessionOverlapsRange(unknown, at(-10), at(10))).toBe(true);
    expect(sessionDurationWithinRange(unknown, at(-10), at(10))).toBeNull();
  });
});

describe("会话展示", () => {
  it("默认返回全部会话，不再静默截断 100 条", () => {
    const views = toSessionViews(
      Array.from({ length: 150 }, (_, index) => ({
        key: `s-${index}`,
        userId: "u1",
        startedAt: at(index),
        endedAt: at(index + 1),
        durationMs: 60_000,
        endReason: "LOGGED_OUT" as const,
        ipAddress: null,
        userAgent: null,
        loginMethod: null,
      })),
    );
    expect(views).toHaveLength(150);
  });

  it("把结束原因翻译成中文，并解析设备", () => {
    const views = toSessionViews([
      {
        key: "s1",
        userId: "u1",
        startedAt: at(0),
        endedAt: at(20),
        durationMs: 20 * 60_000,
        endReason: "LOGGED_OUT",
        ipAddress: "203.0.113.10",
        userAgent: "Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 MicroMessenger/8.0",
        loginMethod: "小程序扫码",
      },
    ]);
    expect(views[0]).toMatchObject({
      endReasonLabel: "已正常登出",
      device: { browser: "微信", deviceType: "手机" },
    });
  });
});
