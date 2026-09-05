import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Pool } from "pg";
import type { Actor } from "@/lib/actor";
import { withActorDb } from "@/lib/actor";
import { submitFeedback, listFeedback } from "@/modules/feedback/feedback-service";

// submitFeedback 内部会同步建 GitHub issue；集成测试只关心 DB/RLS 行为，
// 通道一律按「未配置」处理，避免测试环境真实外呼。
vi.mock("@/modules/feedback/github-issues", () => ({
  createFeedbackIssue: vi.fn().mockResolvedValue({
    status: "skipped",
    reason: "未配置 GITHUB_FEEDBACK_TOKEN",
  }),
}));

const ownerPool = new Pool({
  connectionString: pgConnectionString("DATABASE_MIGRATION_URL"),
  max: 1,
});

let customer: Actor;
let anotherCustomer: Actor;
let technician: Actor;
const createdIds: string[] = [];

beforeAll(async () => {
  const seedUsers = await ownerPool.query<{
    id: string;
    name: string;
    email: string;
    platformRole: Actor["platformRole"];
  }>(
    `SELECT id, name, email, "platformRole" FROM "User"
     WHERE email IN ('client@local.test', 'client2@local.test', 'tech@local.test')`,
  );
  const users = new Map(seedUsers.rows.map((user) => [user.email, user]));
  customer = toActor(requiredUser(users, "client@local.test"));
  anotherCustomer = toActor(requiredUser(users, "client2@local.test"));
  technician = toActor(requiredUser(users, "tech@local.test"));
});

afterAll(async () => {
  if (createdIds.length > 0) {
    await ownerPool.query(`DELETE FROM "Feedback" WHERE id = ANY($1::text[])`, [
      createdIds,
    ]);
  }
  await ownerPool.end();
});

describe("用户反馈 RLS 集成", () => {
  it("客户提交反馈成功落库（含 INSERT RETURNING），返回降级结果", async () => {
    // 回归：feedback_select 策略必须放行提交人本人 —— Prisma create 的
    // INSERT ... RETURNING 会对返回行评估 SELECT 策略，只允许员工时客户
    // 提交会被 RLS 拒绝（「new row violates row-level security policy」）。
    const result = await submitFeedback(customer, {
      title: `集成测试反馈 ${randomUUID().slice(0, 8)}`,
      content: "客户提交的反馈内容",
    }, "WEB");
    createdIds.push(result.id);
    expect(result.issueUrl).toBeNull();

    const row = await ownerPool.query<{
      issueStatus: string;
      submitterId: string;
    }>(
      `SELECT "issueStatus", "submitterId" FROM "Feedback" WHERE id = $1`,
      [result.id],
    );
    expect(row.rows[0]).toMatchObject({
      issueStatus: "SKIPPED",
      submitterId: customer.id,
    });
  });

  it("客户不能插入他人名义的反馈行", async () => {
    await expect(
      withActorDb(customer, (tx) =>
        tx.feedback.create({
          data: {
            title: "冒名反馈",
            content: "x",
            source: "WEB",
            submitterId: anotherCustomer.id,
          },
          select: { id: true },
        }),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("客户只能读到自己提交的反馈行", async () => {
    const own = await submitFeedback(customer, {
      title: `自己的反馈 ${randomUUID().slice(0, 8)}`,
      content: "x",
    }, "WEB");
    const foreign = await submitFeedback(anotherCustomer, {
      title: `别人的反馈 ${randomUUID().slice(0, 8)}`,
      content: "x",
    }, "WEB");
    createdIds.push(own.id, foreign.id);

    const visible = await withActorDb(customer, (tx) =>
      tx.feedback.findMany({ select: { id: true } }),
    );
    const ids = visible.map((row) => row.id);
    expect(ids).toContain(own.id);
    expect(ids).not.toContain(foreign.id);
  });

  it("客户没有列表权限：listFeedback 在服务层就被拒", async () => {
    await expect(listFeedback(customer, {})).rejects.toMatchObject({
      code: "FORBIDDEN",
      status: 403,
    });
  });

  it("员工可以看到全部反馈（含他人提交），返回中文标签", async () => {
    const page = await listFeedback(technician, {});
    expect(page.total).toBeGreaterThanOrEqual(createdIds.length);
    for (const id of createdIds) {
      expect(page.rows.some((row) => row.id === id)).toBe(true);
    }
    const sample = page.rows.find((row) => row.id === createdIds[0]);
    expect(sample?.sourceLabel).toBe("Web 端");
    expect(sample?.issueStatusLabel).toBe("未同步（未配置）");
    expect(sample?.submitter?.id).toBeTruthy();
  });

  it("客户不能篡改 issue 同步字段（UPDATE 仅平台管理员/系统）", async () => {
    const created = await submitFeedback(customer, {
      title: `防篡改 ${randomUUID().slice(0, 8)}`,
      content: "x",
    }, "WEB");
    createdIds.push(created.id);

    // UPDATE 策略只放平台管理员：客户视角下行被 USING 过滤，
    // Prisma 表现为 P2025（找不到要更新的记录），同样拒绝篡改
    await expect(
      withActorDb(customer, (tx) =>
        tx.feedback.update({
          where: { id: created.id },
          data: { issueStatus: "CREATED", issueUrl: "https://example.com" },
        }),
      ),
    ).rejects.toThrow(/row-level security|No record was found/);
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
  };
}

function pgConnectionString(key: "DATABASE_URL" | "DATABASE_MIGRATION_URL") {
  const value = process.env[key];
  if (!value) throw new Error(`缺少环境变量：${key}`);
  const url = new URL(value);
  url.searchParams.delete("schema");
  return url.toString();
}
