import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client, Pool } from "pg";
import type { Actor } from "@/lib/actor";
import {
  addRequestMessage,
} from "@/modules/requests/request-command-service";
import { updateRequestPresence } from "@/modules/requests/request-presence-service";
import { createRequest } from "@/modules/requests/request-service";

const ownerPool = new Pool({
  connectionString: process.env.DATABASE_MIGRATION_URL,
  max: 1,
});

const requestIds: string[] = [];
let projectId: string;
let categoryId: string;
let customer: Actor;
let manager: Actor;
let technician: Actor;
let admin: Actor;

beforeAll(async () => {
  const result = await ownerPool.query<{
    project_id: string;
    category_id: string;
    customer_id: string;
    customer_name: string;
    customer_email: string;
    manager_id: string;
    manager_name: string;
    manager_email: string;
    technician_id: string;
    technician_name: string;
    technician_email: string;
    admin_id: string;
    admin_name: string;
    admin_email: string;
  }>(
    `
      SELECT
        project.id AS project_id,
        category.id AS category_id,
        customer.id AS customer_id,
        customer.name AS customer_name,
        customer.email AS customer_email,
        manager.id AS manager_id,
        manager.name AS manager_name,
        manager.email AS manager_email,
        technician.id AS technician_id,
        technician.name AS technician_name,
        technician.email AS technician_email,
        admin.id AS admin_id,
        admin.name AS admin_name,
        admin.email AS admin_email
      FROM "Project" project
      JOIN "RequestCategory" category
        ON category."serviceTypeId" = project."serviceTypeId"
      JOIN "User" customer ON customer.email = 'client@local.test'
      JOIN "User" manager ON manager.email = 'manager@local.test'
      JOIN "User" technician ON technician.email = 'tech@local.test'
      JOIN "User" admin ON admin.email = 'admin@local.test'
      WHERE project.title = '官网 SEO 优化服务'
        AND project.status = 'ACTIVE'
        AND category.active = true
      LIMIT 1
    `,
  );
  const row = result.rows[0];
  if (!row) {
    throw new Error("请先执行 pnpm test:integration:prepare 准备 *_test 库与种子数据");
  }
  projectId = row.project_id;
  categoryId = row.category_id;
  customer = actor(
    row.customer_id,
    row.customer_name,
    row.customer_email,
    "CUSTOMER",
  );
  manager = actor(
    row.manager_id,
    row.manager_name,
    row.manager_email,
    "PROJECT_MANAGER",
  );
  technician = actor(
    row.technician_id,
    row.technician_name,
    row.technician_email,
    "TECHNICIAN",
  );
  admin = actor(
    row.admin_id,
    row.admin_name,
    row.admin_email,
    "PLATFORM_ADMIN",
  );
});

afterAll(async () => {
  if (requestIds.length > 0) {
    await ownerPool.query(
      `
        DELETE FROM "AuditLog"
        WHERE "serviceRequestId" = ANY($1::text[])
          OR "resourceId" = ANY($1::text[])
      `,
      [requestIds],
    );
    await ownerPool.query(
      'DELETE FROM "ServiceRequest" WHERE id = ANY($1::text[])',
      [requestIds],
    );
  }
  await ownerPool.end();
});

describe("请求聊天生产流程", () => {
  it("创建请求时同步生成包含标题和描述的首条消息", async () => {
    const created = await createFixtureRequest("首条消息");
    const result = await ownerPool.query<{
      id: string;
      body: string;
      is_initial: boolean;
      author_id: string;
    }>(
      `
        SELECT
          id,
          body,
          "isInitial" AS is_initial,
          "authorId" AS author_id
        FROM "RequestMessage"
        WHERE id = $1
      `,
      [created.initialMessageId],
    );

    expect(result.rows[0]).toMatchObject({
      id: created.initialMessageId,
      is_initial: true,
      author_id: customer.id,
    });
    expect(result.rows[0]?.body).toContain("<h3>首条消息");
    expect(result.rows[0]?.body).toContain("用于验证请求描述进入聊天");
  });

  it("两名后台人员并发公开回复时只接手一次", async () => {
    const created = await createFixtureRequest("并发接手");
    const results = await Promise.allSettled([
      addRequestMessage(manager, created.id, {
        body: "<p>经理开始处理</p>",
        visibility: "CUSTOMER_VISIBLE",
      }),
      addRequestMessage(technician, created.id, {
        body: "<p>技术员开始处理</p>",
        visibility: "CUSTOMER_VISIBLE",
      }),
    ]);
    expect(results.some((result) => result.status === "fulfilled")).toBe(true);

    const result = await ownerPool.query<{
      assignee_count: string;
      system_count: string;
    }>(
      `
        SELECT
          (
            SELECT COUNT(*)
            FROM "RequestAssignee"
            WHERE "serviceRequestId" = $1
          )::text AS assignee_count,
          (
            SELECT COUNT(*)
            FROM "RequestMessage"
            WHERE "serviceRequestId" = $1
              AND "isSystem" = true
              AND body LIKE '%已接手此请求%'
          )::text AS system_count
      `,
      [created.id],
    );
    expect(result.rows[0]).toEqual({
      assignee_count: "1",
      system_count: "1",
    });
  });

  it("项目负责人公开回复会为客户创建通知", async () => {
    const created = await createFixtureRequest("客户回复通知");
    await addRequestMessage(manager, created.id, {
      body: "<p>项目负责人正在处理，请客户查看。</p>",
      visibility: "CUSTOMER_VISIBLE",
    });

    const result = await ownerPool.query<{ notification_count: string }>(
      `
        SELECT COUNT(*)::text AS notification_count
        FROM "Notification"
        WHERE "serviceRequestId" = $1
          AND "userId" = $2
          AND type = 'REQUEST_MESSAGE'
          AND "readAt" IS NULL
      `,
      [created.id, customer.id],
    );
    expect(result.rows[0]?.notification_count).toBe("1");
  });

  it("平台管理员公开回复不接手，后续技术员可以接手", async () => {
    const created = await createFixtureRequest("管理员不接手");
    await addRequestMessage(admin, created.id, {
      body: "<p>管理员参与确认</p>",
      visibility: "CUSTOMER_VISIBLE",
    });
    const beforeClaim = await requestAssignment(created.id);
    expect(beforeClaim).toEqual({
      assignee_id: null,
      system_count: "0",
    });

    await addRequestMessage(technician, created.id, {
      body: "<p>技术员正式处理</p>",
      visibility: "CUSTOMER_VISIBLE",
    });
    const afterClaim = await requestAssignment(created.id);
    expect(afterClaim).toEqual({
      assignee_id: technician.id,
      system_count: "1",
    });
  });

  it("回复引用遵守同请求和内部可见范围", async () => {
    const created = await createFixtureRequest("引用权限");
    const publicReply = await addRequestMessage(manager, created.id, {
      body: "<p>公开处理说明</p>",
      visibility: "CUSTOMER_VISIBLE",
    });
    const internalReply = await addRequestMessage(manager, created.id, {
      body: "<p>内部排查记录</p>",
      visibility: "INTERNAL",
    });

    await expect(
      addRequestMessage(manager, created.id, {
        body: "<p>错误公开引用</p>",
        visibility: "CUSTOMER_VISIBLE",
        replyToMessageId: internalReply.message.id,
      }),
    ).rejects.toThrow("内部消息只能通过内部备注回复");

    await expect(
      addRequestMessage(customer, created.id, {
        body: "<p>客户无法引用内部消息</p>",
        visibility: "CUSTOMER_VISIBLE",
        replyToMessageId: internalReply.message.id,
      }),
    ).rejects.toThrow();

    const internalQuote = await addRequestMessage(manager, created.id, {
      body: "<p>继续内部讨论</p>",
      visibility: "INTERNAL",
      replyToMessageId: internalReply.message.id,
    });
    expect(internalQuote.message.replyToMessageId).toBe(
      internalReply.message.id,
    );

    const otherRequest = await createFixtureRequest("跨请求引用");
    await expect(
      addRequestMessage(customer, otherRequest.id, {
        body: "<p>错误跨请求引用</p>",
        visibility: "CUSTOMER_VISIBLE",
        replyToMessageId: publicReply.message.id,
      }),
    ).rejects.toThrow();
  });

  it("自动状态变化不写系统消息，通知按请求聚合", async () => {
    const created = await createFixtureRequest("通知聚合");
    await addRequestMessage(technician, created.id, {
      body: "<p>先接手并回复客户</p>",
      visibility: "CUSTOMER_VISIBLE",
    });
    await ownerPool.query(
      `
        UPDATE "Notification"
        SET "readAt" = NOW(), "aggregationKey" = NULL
        WHERE "userId" = $1 AND "serviceRequestId" = $2
      `,
      [technician.id, created.id],
    );

    await addRequestMessage(customer, created.id, {
      body: "<p>第一条客户补充内容</p>",
      visibility: "CUSTOMER_VISIBLE",
    });
    await addRequestMessage(customer, created.id, {
      body: "<p>第二条客户补充内容</p>",
      visibility: "CUSTOMER_VISIBLE",
    });

    const result = await ownerPool.query<{
      notification_count: string;
      occurrence_count: number;
      body: string;
      status_system_count: string;
    }>(
      `
        SELECT
          (
            SELECT COUNT(*)
            FROM "Notification"
            WHERE "userId" = $1
              AND "serviceRequestId" = $2
              AND "readAt" IS NULL
          )::text AS notification_count,
          notification."occurrenceCount" AS occurrence_count,
          notification.body,
          (
            SELECT COUNT(*)
            FROM "RequestMessage"
            WHERE "serviceRequestId" = $2
              AND "isSystem" = true
              AND body LIKE '%状态%'
          )::text AS status_system_count
        FROM "Notification" notification
        WHERE notification."userId" = $1
          AND notification."serviceRequestId" = $2
          AND notification."readAt" IS NULL
        LIMIT 1
      `,
      [technician.id, created.id],
    );
    expect(result.rows[0]).toEqual({
      notification_count: "1",
      occurrence_count: 2,
      body: "第二条客户补充内容",
      status_system_count: "0",
    });
  });

  it("在线状态支持多标签页，并抑制当前请求通知", async () => {
    const created = await createFixtureRequest("在线状态");
    await addRequestMessage(technician, created.id, {
      body: "<p>接手在线状态测试</p>",
      visibility: "CUSTOMER_VISIBLE",
    });
    const customerSession = randomUUID();
    const staffSessionA = randomUUID();
    const staffSessionB = randomUUID();

    expect(
      await updateRequestPresence(customer, created.id, {
        sessionId: customerSession,
        action: "heartbeat",
      }),
    ).toEqual({ counterpartOnline: false });
    expect(
      await updateRequestPresence(technician, created.id, {
        sessionId: staffSessionA,
        action: "heartbeat",
      }),
    ).toEqual({ counterpartOnline: true });
    await updateRequestPresence(technician, created.id, {
      sessionId: staffSessionB,
      action: "heartbeat",
    });
    expect(
      await updateRequestPresence(customer, created.id, {
        sessionId: customerSession,
        action: "heartbeat",
      }),
    ).toEqual({ counterpartOnline: true });

    const listener = new Client({
      connectionString: process.env.DATABASE_MIGRATION_URL,
    });
    await listener.connect();
    await listener.query("LISTEN service_platform_transient_events");
    try {
      const typingEvent = waitForTransientEvent(listener);
      await updateRequestPresence(customer, created.id, {
        sessionId: customerSession,
        action: "typing",
        typing: true,
        visibility: "CUSTOMER_VISIBLE",
      });
      await expect(typingEvent).resolves.toMatchObject({
        type: "REQUEST_TYPING_CHANGED",
        userIds: [technician.id],
        payload: {
          requestId: created.id,
          actorId: customer.id,
          group: "CUSTOMER",
          typing: true,
        },
      });
    } finally {
      await listener.end();
    }

    await ownerPool.query(
      `
        UPDATE "Notification"
        SET "readAt" = NOW(), "aggregationKey" = NULL
        WHERE "userId" = $1 AND "serviceRequestId" = $2
      `,
      [technician.id, created.id],
    );
    await addRequestMessage(customer, created.id, {
      body: "<p>在线时不进入右上角通知</p>",
      visibility: "CUSTOMER_VISIBLE",
    });
    const suppressed = await ownerPool.query<{ count: string }>(
      `
        SELECT COUNT(*)::text AS count
        FROM "Notification"
        WHERE "userId" = $1
          AND "serviceRequestId" = $2
          AND "readAt" IS NULL
      `,
      [technician.id, created.id],
    );
    expect(suppressed.rows[0]?.count).toBe("0");

    await updateRequestPresence(technician, created.id, {
      sessionId: staffSessionA,
      action: "leave",
    });
    expect(
      await updateRequestPresence(customer, created.id, {
        sessionId: customerSession,
        action: "heartbeat",
      }),
    ).toEqual({ counterpartOnline: true });
    await updateRequestPresence(technician, created.id, {
      sessionId: staffSessionB,
      action: "leave",
    });
    expect(
      await updateRequestPresence(customer, created.id, {
        sessionId: customerSession,
        action: "heartbeat",
      }),
    ).toEqual({ counterpartOnline: false });
    await updateRequestPresence(customer, created.id, {
      sessionId: customerSession,
      action: "leave",
    });
  });
});

async function createFixtureRequest(label: string) {
  const request = await createRequest(customer, projectId, {
    title: `${label} ${randomUUID().slice(0, 8)}`,
    description: "<p>用于验证请求描述进入聊天</p>",
    categoryId,
    priority: "NORMAL",
  });
  requestIds.push(request.id);
  return request;
}

async function requestAssignment(requestId: string) {
  const result = await ownerPool.query<{
    assignee_id: string | null;
    system_count: string;
  }>(
    `
      SELECT
        request."assigneeId" AS assignee_id,
        (
          SELECT COUNT(*)
          FROM "RequestMessage"
          WHERE "serviceRequestId" = request.id
            AND "isSystem" = true
        )::text AS system_count
      FROM "ServiceRequest" request
      WHERE request.id = $1
    `,
    [requestId],
  );
  return result.rows[0];
}

function actor(
  id: string,
  name: string,
  email: string,
  platformRole: Actor["platformRole"],
): Actor {
  return {
    id,
    name,
    email,
    platformRole,
    isPlatformAdmin: platformRole === "PLATFORM_ADMIN",
    isStaff: platformRole !== "CUSTOMER",
  };
}

function waitForTransientEvent(client: Client) {
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    const timer = setTimeout(() => {
      client.removeListener("notification", handleNotification);
      reject(new Error("等待输入状态实时事件超时"));
    }, 5_000);
    const handleNotification = (message: { payload?: string }) => {
      clearTimeout(timer);
      client.removeListener("notification", handleNotification);
      try {
        resolve(JSON.parse(message.payload ?? "{}") as Record<string, unknown>);
      } catch (error) {
        reject(error);
      }
    };
    client.on("notification", handleNotification);
  });
}
