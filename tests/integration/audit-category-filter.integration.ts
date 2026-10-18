import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import type { Actor } from "@/lib/actor";
import { listAuditLogs } from "@/modules/audit/audit-query";
import type { AuditCategoryKey } from "@/modules/audit/audit-types";

const ownerPool = new Pool({
  connectionString: process.env.DATABASE_MIGRATION_URL,
  max: 1,
});

const marker = `audit-category-${randomUUID()}`;
let admin: Actor;
let adminId: string;

const rows: Array<{ action: string; category: AuditCategoryKey }> = [
  { action: "NOTIFICATION_PREFERENCES_UPDATED", category: "SETTINGS" },
  { action: "NOTIFICATION_PREFERENCE_TYPE_UPDATED", category: "AUTH" },
  { action: "SUPPORT_PLAYBOOK_IMAGE_UPLOADED", category: "PROJECT" },
  { action: "SERVICE_TYPE_UPDATED", category: "SETTINGS" },
  { action: "SOMETHING_NEW", category: "OTHER" },
];

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
  adminId = row.id;

  for (const item of rows) {
    await ownerPool.query(
      `INSERT INTO "AuditLog" (
         action, "resourceType", "resourceId", result, "requestId",
         "ipAddress", "actorId", "createdAt"
       ) VALUES ($1, 'AuditCategoryTest', $2, 'SUCCESS', $3, '203.0.113.9', $4, now())`,
      [item.action, `${marker}-${item.action}`, marker, adminId],
    );
  }
});

afterAll(async () => {
  await ownerPool.query(`DELETE FROM "AuditLog" WHERE "requestId" = $1`, [marker]);
  await ownerPool.end();
});

async function actionsFor(category: AuditCategoryKey) {
  const page = await listAuditLogs(admin, {
    category,
    search: marker,
    pageSize: 100,
  });
  return page.rows.map((row) => row.action).sort();
}

describe("审计类目筛选与展示分类一致", () => {
  it("下划线是字面前缀，不会被 SQL LIKE 当成通配符", async () => {
    // NOTIFICATION_PREFERENCES_UPDATED 属于 SETTINGS，而不是 AUTH
    expect(await actionsFor("AUTH")).toEqual([
      "NOTIFICATION_PREFERENCE_TYPE_UPDATED",
    ]);
    expect(await actionsFor("SETTINGS")).toEqual([
      "NOTIFICATION_PREFERENCES_UPDATED",
      "SERVICE_TYPE_UPDATED",
    ]);
  });

  it("重叠前缀按展示层的优先级归类", async () => {
    expect(await actionsFor("PROJECT")).toEqual([
      "SUPPORT_PLAYBOOK_IMAGE_UPLOADED",
    ]);
    expect(await actionsFor("OTHER")).toEqual(["SOMETHING_NEW"]);
  });
});
