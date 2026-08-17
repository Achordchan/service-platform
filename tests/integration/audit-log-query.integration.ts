import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import type { Actor } from "@/lib/actor";
import { withActorDb } from "@/lib/actor";
import { getAuditFacets, listAuditLogs } from "@/modules/audit/audit-query";

const ownerPool = new Pool({
  connectionString: process.env.DATABASE_MIGRATION_URL,
  max: 1,
});

// A unique marker keeps every assertion scoped to this suite's own rows, so the
// suite stays correct no matter what else the shared test database contains.
const marker = `auditq-${randomUUID()}`;

let admin: Actor;
let technician: Actor;

beforeAll(async () => {
  const context = await ownerPool.query<{
    admin_id: string;
    admin_name: string;
    admin_email: string;
    admin_role: Actor["platformRole"];
  }>(
    `SELECT id AS admin_id, name AS admin_name, email AS admin_email,
            "platformRole" AS admin_role
       FROM "User" WHERE email = 'admin@local.test' LIMIT 1`,
  );
  const row = context.rows[0];
  if (!row) {
    throw new Error("请先执行 pnpm test:integration:prepare 创建审计查询测试所需数据");
  }

  admin = {
    id: row.admin_id,
    name: row.admin_name,
    email: row.admin_email,
    platformRole: row.admin_role,
    isPlatformAdmin: true,
    isStaff: true,
  };
  technician = { ...admin, platformRole: "TECHNICIAN", isPlatformAdmin: false };

  await insertLog({
    action: `${marker}.PROJECT_CREATED`,
    resourceType: `${marker}-Project`,
    resourceId: `${marker}-p1`,
    result: "SUCCESS",
    ip: "10.0.0.1",
    createdAt: "2026-01-10T00:00:00Z",
    metadata: { title: "第一条" },
  });
  await insertLog({
    action: `${marker}.PROJECT_DELETED`,
    resourceType: `${marker}-Project`,
    resourceId: `${marker}-p2`,
    result: "DENIED",
    ip: "10.0.0.2",
    createdAt: "2026-02-10T00:00:00Z",
    metadata: null,
  });
  await insertLog({
    action: `${marker}.REQUEST_UPDATED`,
    resourceType: `${marker}-ServiceRequest`,
    resourceId: `${marker}-r1`,
    result: "SUCCESS",
    ip: "10.0.0.3",
    createdAt: "2026-03-10T00:00:00Z",
    metadata: { note: "第三条" },
  });
});

afterAll(async () => {
  await ownerPool.query(`DELETE FROM "AuditLog" WHERE action LIKE $1`, [
    `${marker}%`,
  ]);
  await ownerPool.end();
});

async function insertLog(input: {
  action: string;
  resourceType: string;
  resourceId: string;
  result: string;
  ip: string;
  createdAt: string;
  metadata: unknown;
}) {
  await ownerPool.query(
    `INSERT INTO "AuditLog" (
       action, "resourceType", "resourceId", result, "actorId",
       "ipAddress", "userAgent", metadata, "createdAt"
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      input.action,
      input.resourceType,
      input.resourceId,
      input.result,
      admin.id,
      input.ip,
      "integration-suite/1.0",
      input.metadata === null ? null : JSON.stringify(input.metadata),
      input.createdAt,
    ],
  );
}

function ownRows<T extends { action: string }>(rows: T[]) {
  return rows.filter((row) => row.action.startsWith(marker));
}

describe("审计日志查询", () => {
  it("平台管理员可以读取，且 BigInt 主键序列化为字符串", async () => {
    const page = await listAuditLogs(admin, {
      search: marker,
      pageSize: 100,
    });

    const rows = ownRows(page.rows);
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(typeof row.id).toBe("string");
      expect(row.id).toMatch(/^\d+$/);
      expect(JSON.parse(JSON.stringify(row)).id).toBe(row.id);
    }
    expect(rows[0]?.actorName).toBe(admin.name);
    expect(rows[0]?.actorEmail).toBe(admin.email);
    expect(rows[0]?.userAgent).toBe("integration-suite/1.0");
  });

  it("按 id 倒序返回最新的记录", async () => {
    const page = await listAuditLogs(admin, { search: marker, pageSize: 100 });
    const actions = ownRows(page.rows).map((row) => row.action);
    expect(actions[0]).toBe(`${marker}.REQUEST_UPDATED`);
    expect(actions.at(-1)).toBe(`${marker}.PROJECT_CREATED`);
  });

  it("服务端分页返回正确的 total 与切片", async () => {
    const first = await listAuditLogs(admin, {
      search: marker,
      page: 0,
      pageSize: 2,
    });
    const second = await listAuditLogs(admin, {
      search: marker,
      page: 1,
      pageSize: 2,
    });

    expect(first.total).toBe(3);
    expect(first.rows).toHaveLength(2);
    expect(second.total).toBe(3);
    expect(second.rows).toHaveLength(1);
    expect(second.rows[0]?.action).toBe(`${marker}.PROJECT_CREATED`);
  });

  it("pageSize 被夹在 1..100 之间", async () => {
    const oversized = await listAuditLogs(admin, {
      search: marker,
      pageSize: 5_000,
    });
    expect(oversized.pageSize).toBe(100);

    const undersized = await listAuditLogs(admin, {
      search: marker,
      pageSize: 0,
    });
    expect(undersized.pageSize).toBe(1);
    expect(undersized.rows).toHaveLength(1);
  });

  it("按操作码、资源类型与结果过滤", async () => {
    const byAction = await listAuditLogs(admin, {
      action: `${marker}.PROJECT_DELETED`,
    });
    expect(byAction.total).toBe(1);
    expect(byAction.rows[0]?.resourceId).toBe(`${marker}-p2`);

    const byResource = await listAuditLogs(admin, {
      resourceType: `${marker}-Project`,
    });
    expect(byResource.total).toBe(2);

    const byResult = await listAuditLogs(admin, {
      search: marker,
      result: "DENIED",
    });
    expect(byResult.total).toBe(1);
  });

  it("按时间区间过滤", async () => {
    const windowed = await listAuditLogs(admin, {
      search: marker,
      from: new Date("2026-02-01T00:00:00Z"),
      to: new Date("2026-02-28T00:00:00Z"),
    });
    expect(windowed.total).toBe(1);
    expect(windowed.rows[0]?.action).toBe(`${marker}.PROJECT_DELETED`);
  });

  it("搜索覆盖对象 ID、IP 与执行人，且大小写不敏感", async () => {
    const byResourceId = await listAuditLogs(admin, {
      search: `${marker}-R1`.toUpperCase(),
    });
    expect(byResourceId.total).toBe(1);
    expect(byResourceId.rows[0]?.action).toBe(`${marker}.REQUEST_UPDATED`);

    const byIp = await listAuditLogs(admin, { search: "10.0.0.2" });
    expect(ownRows(byIp.rows)).toHaveLength(1);
  });

  it("facets 汇总出本套件写入的取值", async () => {
    const facets = await getAuditFacets(admin);
    expect(facets.actions).toContain(`${marker}.PROJECT_CREATED`);
    expect(facets.resourceTypes).toContain(`${marker}-ServiceRequest`);
    expect(facets.results).toEqual(expect.arrayContaining(["SUCCESS", "DENIED"]));
  });

  it("非平台管理员在服务层被拒绝", async () => {
    await expect(listAuditLogs(technician, {})).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(getAuditFacets(technician)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("即使绕过服务层，RLS 也让非管理员读不到任何审计记录", async () => {
    const visible = await withActorDb(technician, (tx) =>
      tx.auditLog.count({ where: { action: { startsWith: marker } } }),
    );
    expect(visible).toBe(0);

    const adminVisible = await withActorDb(admin, (tx) =>
      tx.auditLog.count({ where: { action: { startsWith: marker } } }),
    );
    expect(adminVisible).toBe(3);
  });
});
