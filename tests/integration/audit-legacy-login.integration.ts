import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import type { Actor } from "@/lib/actor";
import {
  getAuditOverview,
  getAuditPersonDetail,
} from "@/modules/audit/audit-activity";

const ownerPool = new Pool({
  connectionString: process.env.DATABASE_MIGRATION_URL,
  max: 1,
});

const marker = `audit-legacy-login-${randomUUID()}`;
const email = `${marker}@example.test`;
let userId: string;
let admin: Actor;

beforeAll(async () => {
  const context = await ownerPool.query<{
    id: string;
    name: string;
    email: string;
    platformRole: Actor["platformRole"];
  }>(
    `SELECT id, name, email, "platformRole" FROM "User" WHERE email = 'admin@local.test' LIMIT 1`,
  );
  const row = context.rows[0];
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
     VALUES ($1, '旧登录测试用户', $2, 'CUSTOMER', now(), now())`,
    [userId, email],
  );
  const insert = (metadata: unknown, at: string) =>
    ownerPool.query(
      `INSERT INTO "AuditLog" (
         action, "resourceType", "resourceId", result, metadata, "requestId",
         "ipAddress", "userAgent", "actorId", "createdAt"
       ) VALUES ('USER_LOGIN', 'User', $1, 'SUCCESS', $2::jsonb, $3,
                 '203.0.113.8', 'integration-suite/1.0', $1, $4)`,
      [userId, metadata === null ? null : JSON.stringify(metadata), marker, at],
    );
  // 历史登录没有 metadata，不能被“排除改密事件”的过滤误伤
  await insert(null, "2026-01-10T10:00:00Z");
  // 改密重建事件更晚，但不能成为“最近登录”
  await insert({ path: "/change-password" }, "2026-01-10T11:00:00Z");
});

afterAll(async () => {
  await ownerPool.query(`DELETE FROM "AuditLog" WHERE "requestId" = $1`, [marker]);
  await ownerPool.query(`DELETE FROM "User" WHERE id = $1`, [userId]);
  await ownerPool.end();
});

describe("审计登录过滤", () => {
  it("没有 metadata.path 的历史登录仍算登录，改密重建不算", async () => {
    const detail = await getAuditPersonDetail(admin, userId, {
      from: new Date("2026-01-10T00:00:00Z"),
      to: new Date("2026-01-10T23:59:59.999Z"),
    });
    expect(detail).not.toBeNull();
    expect(detail!.totals.loginCount).toBe(1);
    expect(detail!.person.lastLoginAt).toBe("2026-01-10T10:00:00.000Z");

    const overview = await getAuditOverview(admin, {
      from: new Date("2026-01-10T00:00:00Z"),
      to: new Date("2026-01-10T23:59:59.999Z"),
    });
    expect(
      overview.recentLogins.some((row) => row.actorName === "旧登录测试用户"),
    ).toBe(true);
  });
});
