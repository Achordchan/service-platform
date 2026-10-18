import { describe, expect, it } from "vitest";
import {
  buildAuditSessions,
  toSessionViews,
  type AuditAuthEvent,
  type AuditLiveSession,
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
}): AuditLiveSession {
  return {
    id: input.id,
    userId: input.userId ?? "u1",
    createdAt: at(input.minutes),
    expiresAt: at(input.minutes + 60 * 24 * 7),
    ipAddress: input.ipAddress ?? "203.0.113.10",
    userAgent: input.userAgent ?? "Mozilla/5.0 Chrome/138.0",
    client: "WEB",
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

describe("会话展示", () => {
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
