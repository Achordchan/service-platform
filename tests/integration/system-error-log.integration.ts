import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Pool } from "pg";
import type { Actor } from "@/lib/actor";
import { withActorDb, withSystemDb } from "@/lib/actor";
import {
  recordSystemError,
  resetSystemErrorThrottleForTest,
} from "@/lib/system-error-log";
import { cleanupExpiredSystemErrorLogs } from "@/modules/system-errors/system-error-retention";
import {
  exportSystemErrors,
  getSystemErrorDetail,
  getSystemErrorFacets,
  listSystemErrors,
} from "@/modules/system-errors/system-error-query";
import { toExportCsv, toExportJson } from "@/modules/system-errors/system-error-export";

const ownerPool = new Pool({
  connectionString: pgConnectionString("DATABASE_MIGRATION_URL"),
  max: 1,
});

const prefix = `itest_${randomUUID().slice(0, 8)}`;
let admin: Actor;
let technician: Actor;
let customer: Actor;

beforeAll(async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const seedUsers = await ownerPool.query<{
    id: string;
    name: string;
    email: string;
    platformRole: Actor["platformRole"];
  }>(
    `SELECT id, name, email, "platformRole" FROM "User"
     WHERE email IN ('admin@local.test', 'client@local.test', 'tech@local.test')`,
  );
  const users = new Map(seedUsers.rows.map((user) => [user.email, user]));
  admin = toActor(requiredUser(users, "admin@local.test"));
  technician = toActor(requiredUser(users, "tech@local.test"));
  customer = toActor(requiredUser(users, "client@local.test"));
});

afterAll(async () => {
  await ownerPool.query(`DELETE FROM "SystemErrorLog" WHERE "referenceId" LIKE $1`, [
    `${prefix}%`,
  ]);
  await ownerPool.query(`DELETE FROM "AuditLog" WHERE action = $1`, [
    `${prefix}_ROLLBACK`,
  ]);
  await ownerPool.query(`DELETE FROM "SystemErrorLog" WHERE operation LIKE $1`, [
    `${prefix}%`,
  ]);
  await ownerPool.end();
  vi.restoreAllMocks();
});

describe("系统报错日志集成", () => {
  it("落库保存编号、来源、操作者和脱敏后的结构化内容", async () => {
    resetSystemErrorThrottleForTest();
    const referenceId = `${prefix}_basic`;
    const error = new Error("password=hunter2 ops@example.com");
    error.name = "PrismaClientKnownRequestError";

    const result = await recordSystemError(error, {
      referenceId,
      source: "project-api",
      operation: "project.create",
      request: { method: "POST", path: "/api/v1/projects/ops%40example.com" },
      actor: { type: "STAFF", id: technician.id },
      context: { mailMessageId: "mail-1", ignored: { nested: true } },
    });

    expect(result).toEqual({ referenceId, persisted: true });
    const row = await ownerPool.query(
      `SELECT * FROM "SystemErrorLog" WHERE "referenceId" = $1`,
      [referenceId],
    );
    expect(row.rows).toHaveLength(1);
    expect(row.rows[0]).toMatchObject({
      category: "UNEXPECTED",
      source: "project-api",
      operation: "project.create",
      requestMethod: "POST",
      actorType: "STAFF",
      actorId: technician.id,
      occurrenceCount: 1,
      context: { mailMessageId: "mail-1" },
    });
    const stored = JSON.stringify(row.rows[0]);
    expect(stored).not.toContain("hunter2");
    expect(stored).not.toContain("ops@example.com");
    expect(stored).not.toContain("ops%40example.com");
  });

  it("业务事务回滚时错误日志仍然存在（核心验收）", async () => {
    resetSystemErrorThrottleForTest();
    const referenceId = `${prefix}_rollback`;
    const rollbackAction = `${prefix}_ROLLBACK`;

    // 复现事故：业务事务里先写了业务行，随后在事务内捕获到错误并记录，事务整体回滚
    await expect(
      withSystemDb(async (tx) => {
        await tx.auditLog.create({
          data: { action: rollbackAction, resourceType: "TEST" },
        });
        await recordSystemError(new Error("boom"), {
          referenceId,
          source: "project-api",
          operation: "request.create",
        });
        throw new Error("force rollback");
      }),
    ).rejects.toThrow("force rollback");

    const business = await ownerPool.query(
      `SELECT 1 FROM "AuditLog" WHERE action = $1`,
      [rollbackAction],
    );
    expect(business.rows).toHaveLength(0);
    const log = await ownerPool.query(
      `SELECT 1 FROM "SystemErrorLog" WHERE "referenceId" = $1`,
      [referenceId],
    );
    expect(log.rows).toHaveLength(1);
  });

  it("同一编号重复发生时累加次数并刷新时间，不堆积行", async () => {
    resetSystemErrorThrottleForTest();
    const referenceId = `${prefix}_mail_dup`;
    await recordSystemError(new Error("first"), {
      referenceId,
      source: "mail-worker",
      operation: "mail.queue_failed",
    });
    const first = await ownerPool.query<{ createdAt: Date }>(
      `SELECT "createdAt" FROM "SystemErrorLog" WHERE "referenceId" = $1`,
      [referenceId],
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    await recordSystemError(new Error("second"), {
      referenceId,
      source: "mail-worker",
      operation: "mail.queue_failed",
    });

    const rows = await ownerPool.query<{
      occurrenceCount: number;
      createdAt: Date;
    }>(
      `SELECT "occurrenceCount", "createdAt" FROM "SystemErrorLog" WHERE "referenceId" = $1`,
      [referenceId],
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0].occurrenceCount).toBe(2);
    expect(rows.rows[0].createdAt.getTime()).toBeGreaterThan(
      first.rows[0].createdAt.getTime(),
    );
  });

  it("非平台管理员读不到、写不进、删不掉", async () => {
    resetSystemErrorThrottleForTest();
    const referenceId = `${prefix}_rls`;
    await recordSystemError(new Error("x"), { referenceId, source: "project-api" });

    for (const actor of [technician, customer]) {
      const visible = await withActorDb(actor, (tx) =>
        tx.systemErrorLog.findMany({ where: { referenceId } }),
      );
      expect(visible).toHaveLength(0);

      await expect(
        withActorDb(actor, (tx) =>
          tx.systemErrorLog.create({
            data: {
              referenceId: `${prefix}_forged_${actor.id}`,
              category: "UNEXPECTED",
              errorName: "Error",
              source: "forged",
              details: {},
            },
          }),
        ),
      ).rejects.toThrow();

      const removed = await withActorDb(actor, (tx) =>
        tx.systemErrorLog.deleteMany({ where: { referenceId } }),
      );
      expect(removed.count).toBe(0);
    }

    const stillThere = await ownerPool.query(
      `SELECT 1 FROM "SystemErrorLog" WHERE "referenceId" = $1`,
      [referenceId],
    );
    expect(stillThere.rows).toHaveLength(1);
  });

  it("保留期清理只删过期行", async () => {
    resetSystemErrorThrottleForTest();
    const oldId = `${prefix}_old`;
    const freshId = `${prefix}_fresh`;
    await recordSystemError(new Error("old"), { referenceId: oldId, source: "project-api" });
    await recordSystemError(new Error("fresh"), { referenceId: freshId, source: "project-api" });
    await ownerPool.query(
      `UPDATE "SystemErrorLog" SET "createdAt" = now() - interval '200 days' WHERE "referenceId" = $1`,
      [oldId],
    );

    const deleted = await cleanupExpiredSystemErrorLogs(90);

    expect(deleted).toBeGreaterThanOrEqual(1);
    const left = await ownerPool.query<{ referenceId: string }>(
      `SELECT "referenceId" FROM "SystemErrorLog" WHERE "referenceId" = ANY($1::text[])`,
      [[oldId, freshId]],
    );
    expect(left.rows.map((row) => row.referenceId)).toEqual([freshId]);
  });
});

describe("系统报错查询服务集成", () => {
  async function seed(suffix: string, overrides: Partial<Parameters<typeof recordSystemError>[1]> = {}) {
    resetSystemErrorThrottleForTest();
    // 真实格式的编号，错误编号搜索才认得；清理靠 operation 前缀
    const referenceId = `err_${randomUUID().replaceAll("-", "")}`;
    await recordSystemError(new Error("seed"), {
      referenceId,
      source: "query-test",
      operation: `${prefix}.op`,
      context: { label: suffix },
      ...overrides,
    });
    return referenceId;
  }

  it("按错误编号精确搜索，并把用户报错整句话里的编号提取出来", async () => {
    const referenceId = await seed("find");
    await seed("other");

    const exact = await listSystemErrors(admin, { referenceId });
    expect(exact.total).toBe(1);
    expect(exact.rows[0].referenceId).toBe(referenceId);

    const sentence = await listSystemErrors(admin, {
      search: `操作暂时失败，请稍后重试。错误编号：${referenceId}`,
    });
    expect(sentence.rows.map((row) => row.referenceId)).toEqual([referenceId]);
  });

  it("按分类、来源、时间范围筛选，并带出操作者姓名", async () => {
    const referenceId = await seed("filter", {
      actor: { type: "STAFF", id: technician.id },
    });

    const page = await listSystemErrors(admin, {
      source: "query-test",
      operation: `${prefix}.op`,
      category: "UNEXPECTED",
      from: new Date(Date.now() - 60_000),
      to: new Date(Date.now() + 60_000),
    });
    const row = page.rows.find((item) => item.referenceId === referenceId);

    expect(row).toMatchObject({ actorType: "STAFF", actorName: technician.name });
    const none = await listSystemErrors(admin, {
      source: "query-test",
      from: new Date(Date.now() + 3_600_000),
    });
    expect(none.total).toBe(0);

    const facets = await getSystemErrorFacets(admin);
    expect(facets.sources).toContain("query-test");
    expect(facets.categories).toContain("UNEXPECTED");
  });

  it("详情带同一操作最近 24 小时的同类错误，不含自己", async () => {
    const first = await seed("rel_a");
    const second = await seed("rel_b");
    const unrelated = await seed("rel_c", { operation: `${prefix}.other_op` });

    const detail = await getSystemErrorDetail(admin, second);

    expect(detail?.referenceId).toBe(second);
    const related = detail?.related.map((item) => item.referenceId) ?? [];
    expect(related).toContain(first);
    expect(related).not.toContain(second);
    expect(related).not.toContain(unrelated);
    expect(await getSystemErrorDetail(admin, `${prefix}_missing`)).toBeNull();
  });

  it("非平台管理员调用查询服务直接被拒绝", async () => {
    await expect(listSystemErrors(technician, {})).rejects.toThrow();
    await expect(getSystemErrorFacets(customer)).rejects.toThrow();
    await expect(getSystemErrorDetail(technician, "x")).rejects.toThrow();
    await expect(exportSystemErrors(customer, {})).rejects.toThrow();
  });

  it("导出文件里没有凭据、邮箱、手机号、请求体和操作者姓名（核心验收）", async () => {
    resetSystemErrorThrottleForTest();
    const referenceId = `${prefix}_privacy`;
    const error = new Error(
      "boom ops@example.com password=hunter2 Bearer abcdefghijklmnop phone 13800138000",
    );
    await recordSystemError(error, {
      referenceId,
      source: "query-test",
      operation: `${prefix}.privacy`,
      request: {
        method: "POST",
        path: "/api/v1/requests/ops%40example.com/13800138000?body=secret-body",
      },
      actor: { type: "STAFF", id: technician.id },
      context: { note: "reply to ops@example.com" },
    });

    const result = await exportSystemErrors(admin, { referenceId });
    const output = JSON.stringify(toExportJson(result.rows)) + toExportCsv(result.rows);

    expect(result.rows).toHaveLength(1);
    for (const leaked of [
      "ops@example.com",
      "ops%40example.com",
      "hunter2",
      "abcdefghijklmnop",
      "13800138000",
      "secret-body",
      technician.name,
      technician.email,
    ]) {
      expect(output).not.toContain(leaked);
    }
  });
});

function requiredUser<T>(users: Map<string, T>, email: string) {
  const user = users.get(email);
  if (!user) throw new Error(`缺少种子用户：${email}`);
  return user;
}

function toActor(user: {
  id: string;
  name: string;
  email: string;
  platformRole: Actor["platformRole"];
}): Actor {
  return {
    ...user,
    isPlatformAdmin: user.platformRole === "PLATFORM_ADMIN",
    isStaff: user.platformRole !== "CUSTOMER",
    permissions: [],
  };
}

function pgConnectionString(key: "DATABASE_URL" | "DATABASE_MIGRATION_URL") {
  const value = process.env[key];
  if (!value) throw new Error(`缺少环境变量：${key}`);
  const url = new URL(value);
  url.searchParams.delete("schema");
  return url.toString();
}
