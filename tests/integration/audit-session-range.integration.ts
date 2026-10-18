import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import type { Actor } from "@/lib/actor";
import { getAuditPersonDetail } from "@/modules/audit/audit-activity";

const ownerPool = new Pool({
  connectionString: process.env.DATABASE_MIGRATION_URL,
  max: 1,
});

const marker = `audit-session-range-${randomUUID()}`;
const email = `${marker}@example.test`;
let userId: string;
let admin: Actor;

beforeAll(async () => {
  const adminRow = await ownerPool.query<{
    id: string;
    name: string;
    email: string;
    platformRole: Actor["platformRole"];
  }>(
    `SELECT id, name, email, "platformRole" FROM "User" WHERE email = 'admin@local.test' LIMIT 1`,
  );
  const row = adminRow.rows[0];
  if (!row) throw new Error("请先执行 pnpm test:integration:prepare");
  admin = {
    id: row.id,
    name: row.name,
    email: row.email,
    platformRole: row.platformRole,
    isPlatformAdmin: true,
    isStaff: true,
  };

  userId = randomUUID();
  await ownerPool.query(
    `INSERT INTO "User" (id, name, email, "platformRole", "createdAt", "updatedAt")
     VALUES ($1, '审计区间测试用户', $2, 'CUSTOMER', now(), now())`,
    [userId, email],
  );

  const insert = (
    action: "USER_LOGIN" | "USER_LOGOUT",
    at: string,
    sessionId: string,
    extra: Record<string, unknown> = {},
  ) =>
    ownerPool.query(
      `INSERT INTO "AuditLog" (
         action, "resourceType", "resourceId", result, metadata, "requestId",
         "ipAddress", "userAgent", "actorId", "createdAt"
       ) VALUES ($1, 'User', $2, 'SUCCESS', $3::jsonb, $4, '203.0.113.5',
                 'integration-suite/1.0', $2, $5)`,
      [action, userId, JSON.stringify({ sessionId, ...extra }), marker, at],
    );

  // 会话 A：登录早于 30 天 lookback，登出在统计区间内
  await insert("USER_LOGIN", "2025-12-01T00:00:00Z", "sess-old");
  await insert("USER_LOGOUT", "2026-01-10T12:00:00Z", "sess-old");
  // 会话 B：登录在区间前，登出在区间结束之后（历史区间也必须能算出来）
  await insert("USER_LOGIN", "2026-01-09T00:00:00Z", "sess-after");
  await insert("USER_LOGOUT", "2026-01-12T00:00:00Z", "sess-after");
  // 会话 C：登录在区间前，登出在 to + 30 天 lookahead 之外
  await insert("USER_LOGIN", "2026-01-05T00:00:00Z", "sess-late");
  await insert("USER_LOGOUT", "2026-03-15T00:00:00Z", "sess-late");
  // 会话 D：登录早于 from - 30d、登出晚于 to + 30d，两端都在初始窗口外
  await insert("USER_LOGIN", "2025-12-01T00:00:00Z", "sess-spanning");
  await insert("USER_LOGOUT", "2026-03-20T00:00:00Z", "sess-spanning");
  // 会话 E：只有登出，登录在窗口外；靠 sessionStartedAt 发现并补出登录
  await insert("USER_LOGOUT", "2026-03-25T00:00:00Z", "sess-meta", {
    sessionStartedAt: "2025-12-01T00:00:00Z",
  });
});

afterAll(async () => {
  await ownerPool.query(`DELETE FROM "AuditLog" WHERE "requestId" = $1`, [marker]);
  await ownerPool.query(`DELETE FROM "User" WHERE id = $1`, [userId]);
  await ownerPool.end();
});

describe("审计会话与统计区间", () => {
  it("能配对 30 天以上的旧登录，并按区间截取跨边界会话", async () => {
    const detail = await getAuditPersonDetail(admin, userId, {
      from: new Date("2026-01-10T00:00:00Z"),
      to: new Date("2026-01-10T23:59:59.999Z"),
    });

    expect(detail).not.toBeNull();
    expect(detail!.sessions).toHaveLength(5);
    // A 在区间内 12h；B、C、D、E 完整落在区间内各 (24h - 1ms)
    expect(detail!.totals.sessionCount).toBe(5);
    expect(detail!.totals.totalDurationMs).toBe(108 * 3_600_000 - 4);
    expect(detail!.totals.avgDurationMs).toBe(77_759_999);
    expect(detail!.totals.loginCount).toBe(0);
    // 列表仍展示完整起止
    const old = detail!.sessions.find((item) => item.key === "sess-old");
    expect(old?.startedAt).toBe("2025-12-01T00:00:00.000Z");
    expect(old?.endedAt).toBe("2026-01-10T12:00:00.000Z");
    const late = detail!.sessions.find((item) => item.key === "sess-late");
    expect(late?.endedAt).toBe("2026-03-15T00:00:00.000Z");
    const meta = detail!.sessions.find((item) => item.key === "sess-meta");
    expect(meta?.startedAt).toBe("2025-12-01T00:00:00.000Z");
    expect(meta?.endedAt).toBe("2026-03-25T00:00:00.000Z");
  });
});
