import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client, Pool } from "pg";
import type { Actor } from "@/lib/actor";
import {
  addRequestMessage,
  assignRequest,
  changeRequestStatus,
} from "@/modules/requests/request-command-service";
import { revokeRequestMessageByAdmin } from "@/modules/plugins/content-risk-review-service";
import { removeProjectStaff } from "@/modules/projects/project-staff-service";
import { updateRequestPresence } from "@/modules/requests/request-presence-service";
import { closeResolvedRequestsDue } from "@/modules/requests/request-auto-close-service";
import { createRequest, getRequest } from "@/modules/requests/request-service";

const ownerPool = new Pool({
  connectionString: process.env.DATABASE_MIGRATION_URL,
  max: 1,
});

const requestIds: string[] = [];
const riskTargetIds: string[] = [];
const temporaryUserIds: string[] = [];
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
  if (riskTargetIds.length > 0) {
    await ownerPool.query(
      `DELETE FROM "ContentRiskReview" WHERE "targetId" = ANY($1::text[])`,
      [riskTargetIds],
    );
    await ownerPool.query(
      `DELETE FROM "ContentRiskState" WHERE "targetId" = ANY($1::text[])`,
      [riskTargetIds],
    );
  }
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
  if (temporaryUserIds.length > 0) {
    await ownerPool.query('DELETE FROM "User" WHERE id = ANY($1::text[])', [
      temporaryUserIds,
    ]);
  }
  await ownerPool.end();
});

describe("请求聊天生产流程", () => {
  it("只有平台管理员可以手工分配服务请求", async () => {
    const created = await createFixtureRequest("管理员手工分配");

    await expect(
      assignRequest(manager, created.id, { assigneeIds: [technician.id] }),
    ).rejects.toMatchObject({ status: 403 });
    expect(await requestAssignment(created.id)).toEqual({
      assignee_id: null,
      system_count: "0",
    });

    await expect(
      assignRequest(admin, created.id, { assigneeIds: [technician.id] }),
    ).resolves.toMatchObject({
      assigneeId: technician.id,
      assignees: [{ userId: technician.id }],
    });
  });

  it("平台管理员可以填写原因人工撤回客户公开消息", async () => {
    const created = await createFixtureRequest("管理员人工撤回");
    const reply = await addRequestMessage(customer, created.id, {
      body: "<p>这条公开回复需要由管理员撤回</p>",
      visibility: "CUSTOMER_VISIBLE",
    });
    riskTargetIds.push(reply.message.id);

    await revokeRequestMessageByAdmin(
      admin,
      created.id,
      reply.message.id,
      "包含站外联系方式引导",
    );

    const [customerView, managerView, adminView, review, notifications] =
      await Promise.all([
      getRequest(customer, created.id),
      getRequest(manager, created.id),
      getRequest(admin, created.id),
      ownerPool.query<{
        source: string;
        status: string;
        decision_reason: string;
      }>(
        `
          SELECT source, status, "decisionReason" AS decision_reason
          FROM "ContentRiskReview"
          WHERE "targetType" = 'REQUEST_MESSAGE'
            AND "targetId" = $1
          ORDER BY "createdAt" DESC
          LIMIT 1
        `,
        [reply.message.id],
      ),
      ownerPool.query<{
        total: string;
        unread: string;
        email_due: string;
      }>(
        `SELECT
           COUNT(*)::text AS total,
           COUNT(*) FILTER (WHERE "readAt" IS NULL)::text AS unread,
           COUNT(*) FILTER (WHERE "emailDueAt" IS NOT NULL)::text AS email_due
         FROM "Notification"
         WHERE "sourceType" = 'REQUEST_MESSAGE'
           AND "sourceId" = $1`,
        [reply.message.id],
      ),
    ]);
    const customerMessage = customerView.messages.find(
      (message) => message.id === reply.message.id,
    );
    const adminMessage = adminView.messages.find(
      (message) => message.id === reply.message.id,
    );
    const managerMessage = managerView.messages.find(
      (message) => message.id === reply.message.id,
    );

    expect(customerMessage).toMatchObject({
      body: "该内容已撤回",
      contentRiskStatus: "REVOKED",
      contentRiskReason: "包含站外联系方式引导",
      attachments: [],
      reeditBody: "<p>这条公开回复需要由管理员撤回</p>",
      reeditAttachmentCount: 0,
    });
    expect(managerMessage).toMatchObject({
      body: "该内容已撤回",
      contentRiskStatus: "REVOKED",
      reeditBody: null,
    });
    expect(adminMessage).toMatchObject({
      body: "<p>这条公开回复需要由管理员撤回</p>",
      contentRiskStatus: "REVOKED",
      contentRiskReason: "包含站外联系方式引导",
      reeditBody: null,
    });
    expect(review.rows[0]).toEqual({
      source: "ADMIN",
      status: "VIOLATION",
      decision_reason: "包含站外联系方式引导",
    });
    expect(Number(notifications.rows[0]?.total ?? "0")).toBeGreaterThan(0);
    expect(notifications.rows[0]).toMatchObject({
      unread: "0",
      email_due: "0",
    });
  });

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
              AND body LIKE '%已接手此服务请求%'
          )::text AS system_count
      `,
      [created.id],
    );
    expect(result.rows[0]).toEqual({
      assignee_count: "1",
      system_count: "1",
    });
  });

  it("只记录第一次员工公开回复时间", async () => {
    const created = await createFixtureRequest("首响时间");
    expect(created.firstRespondedAt).toBeNull();

    const firstReply = await addRequestMessage(manager, created.id, {
      body: "<p>第一次公开回复</p>",
      visibility: "CUSTOMER_VISIBLE",
    });
    const afterFirstReply = await getRequest(manager, created.id);
    expect(afterFirstReply.firstRespondedAt).toEqual(
      firstReply.message.createdAt,
    );

    await addRequestMessage(manager, created.id, {
      body: "<p>第二次公开回复</p>",
      visibility: "CUSTOMER_VISIBLE",
    });
    const afterSecondReply = await getRequest(manager, created.id);
    expect(afterSecondReply.firstRespondedAt).toEqual(
      firstReply.message.createdAt,
    );
  });

  it("项目负责人公开回复会通知客户，并将接手状态通知平台管理员", async () => {
    const created = await createFixtureRequest("客户回复通知");
    await addRequestMessage(manager, created.id, {
      body: "<p>项目负责人正在处理，请客户查看。</p>",
      visibility: "CUSTOMER_VISIBLE",
    });

    const result = await ownerPool.query<{
      customer_notification_count: string;
      admin_claimed_count: string;
    }>(
      `
        SELECT
          (SELECT COUNT(*)::text
             FROM "Notification"
            WHERE "serviceRequestId" = $1
              AND "userId" = $2
              AND type = 'REQUEST_MESSAGE'
              AND "readAt" IS NULL) AS customer_notification_count,
          (SELECT COUNT(*)::text
             FROM "Notification"
            WHERE "serviceRequestId" = $1
              AND "userId" = $3
              AND type = 'REQUEST_CLAIMED'
              AND "readAt" IS NULL) AS admin_claimed_count
      `,
      [created.id, customer.id, admin.id],
    );
    expect(result.rows[0]).toEqual({
      customer_notification_count: "1",
      admin_claimed_count: "1",
    });
  });

  it("客户回复已分配请求会通知当前处理人和平台管理员", async () => {
    const created = await createFixtureRequest("客户回复后台通知");
    await addRequestMessage(technician, created.id, {
      body: "<p>技术员已接手处理。</p>",
      visibility: "CUSTOMER_VISIBLE",
    });
    await addRequestMessage(customer, created.id, {
      body: "<p>客户补充了新的问题信息。</p>",
      visibility: "CUSTOMER_VISIBLE",
    });

    const result = await ownerPool.query<{ user_id: string }>(
      `
        SELECT "userId" AS user_id
        FROM "Notification"
        WHERE "serviceRequestId" = $1
          AND type = 'REQUEST_MESSAGE'
          AND "readAt" IS NULL
          AND "userId" = ANY($2::text[])
        ORDER BY "userId"
      `,
      [created.id, [technician.id, admin.id]],
    );
    expect(result.rows.map((row) => row.user_id).sort()).toEqual(
      [technician.id, admin.id].sort(),
    );
  });

  it("客户伪造 deliveryOverride 静音不了后台通知", async () => {
    const created = await createFixtureRequest("客户越权覆盖");
    await addRequestMessage(technician, created.id, {
      body: "<p>技术员已接手处理。</p>",
      visibility: "CUSTOMER_VISIBLE",
    });
    // 客户也打这个接口：不挡的话就能用 notification:false 把自己的回复对员工静音，
    // 或用 email:true 强制给已退订的员工发邮件。覆盖是员工写操作专用的能力。
    await addRequestMessage(
      customer,
      created.id,
      {
        body: "<p>客户想悄悄补充信息。</p>",
        visibility: "CUSTOMER_VISIBLE",
      },
      { notification: false, email: true },
    );

    const result = await ownerPool.query<{ user_id: string }>(
      `
        SELECT "userId" AS user_id
        FROM "Notification"
        WHERE "serviceRequestId" = $1
          AND type = 'REQUEST_MESSAGE'
          AND "readAt" IS NULL
          AND "userId" = ANY($2::text[])
        ORDER BY "userId"
      `,
      [created.id, [technician.id, admin.id]],
    );
    expect(result.rows.map((row) => row.user_id).sort()).toEqual(
      [technician.id, admin.id].sort(),
    );

    // 覆盖被丢掉，就不该留下「本次覆盖送达」的审计
    const audit = await ownerPool.query<{ count: string }>(
      `
        SELECT count(*)::text AS count
        FROM "AuditLog"
        WHERE "serviceRequestId" = $1
          AND action = 'NOTIFICATION_DELIVERY_OVERRIDDEN'
      `,
      [created.id],
    );
    expect(audit.rows[0]?.count).toBe("0");
  });

  it("「仅我处理」不会被权限范围或关键词搜索覆盖掉", async () => {
    const { listRequestsForActor, assignRequest } = await import(
      "@/modules/requests/request-service"
    ).then(async (mod) => ({
      listRequestsForActor: mod.listRequestsForActor,
      assignRequest: (await import("@/modules/requests/request-command-service"))
        .assignRequest,
    }));
    const marker = randomUUID().slice(0, 8);
    const mine = await createFixtureRequest(`仅我处理-已分配-${marker}`);
    const others = await createFixtureRequest(`仅我处理-未分配-${marker}`);
    await assignRequest(admin, mine.id, { assigneeIds: [technician.id] });

    // 三组条件都是 OR，同一个对象字面量里重复写会互相覆盖：
    // 技术员不搜索时，「仅我处理」被权限范围那组覆盖 —— 未分配工单仍会冒出来
    const technicianMine = await listRequestsForActor(technician, {
      assignedToMe: true,
    });
    const technicianIds = technicianMine.requests.map((item) => item.id);
    expect(technicianIds).toContain(mine.id);
    expect(technicianIds).not.toContain(others.id);

    // 一旦带上关键词，关键词那组又会把前两组一起覆盖掉
    const searched = await listRequestsForActor(admin, {
      assignedToMe: true,
      query: marker,
    });
    const searchedIds = searched.requests.map((item) => item.id);
    expect(searchedIds).not.toContain(mine.id);
    expect(searchedIds).not.toContain(others.id);

    const technicianSearched = await listRequestsForActor(technician, {
      assignedToMe: true,
      query: marker,
    });
    const technicianSearchedIds = technicianSearched.requests.map(
      (item) => item.id,
    );
    expect(technicianSearchedIds).toEqual([mine.id]);
  });

  it("历史遗留的无效处理人不会阻断管理员更新状态", async () => {
    const created = await createFixtureRequest("无效处理人通知过滤");
    const staleUserId = randomUUID();
    temporaryUserIds.push(staleUserId);
    await ownerPool.query(
      `INSERT INTO "User" (id, name, email, "emailVerified", "platformRole", "createdAt", "updatedAt")
       VALUES ($1, '已移除处理人', $2, true, 'TECHNICIAN', NOW(), NOW())`,
      [staleUserId, `stale-${staleUserId}@example.test`],
    );
    await ownerPool.query(
      `UPDATE "ServiceRequest" SET "assigneeId" = $2 WHERE id = $1`,
      [created.id, staleUserId],
    );
    await ownerPool.query(
      `INSERT INTO "RequestAssignee" (id, "serviceRequestId", "userId", "assignedById")
       VALUES ($1, $2, $3, $4)`,
      [randomUUID(), created.id, staleUserId, admin.id],
    );

    await expect(
      changeRequestStatus(admin, created.id, "IN_PROGRESS"),
    ).resolves.toMatchObject({ status: "IN_PROGRESS" });
  });

  it("移除项目成员会同步解除其全部工单分配", async () => {
    const created = await createFixtureRequest("移除成员解除分配");
    const removableUserId = randomUUID();
    const projectStaffId = randomUUID();
    temporaryUserIds.push(removableUserId);
    await ownerPool.query(
      `INSERT INTO "User" (id, name, email, "emailVerified", "platformRole", "createdAt", "updatedAt")
       VALUES ($1, '待移除处理人', $2, true, 'TECHNICIAN', NOW(), NOW())`,
      [removableUserId, `remove-${removableUserId}@example.test`],
    );
    await ownerPool.query(
      `INSERT INTO "ProjectStaff" (id, "projectId", "userId", role)
       VALUES ($1, $2, $3, 'TECHNICIAN')`,
      [projectStaffId, projectId, removableUserId],
    );
    await ownerPool.query(
      `UPDATE "ServiceRequest" SET "assigneeId" = $2 WHERE id = $1`,
      [created.id, removableUserId],
    );
    await ownerPool.query(
      `INSERT INTO "RequestAssignee" (id, "serviceRequestId", "userId", "assignedById")
       VALUES ($1, $2, $3, $4)`,
      [randomUUID(), created.id, removableUserId, admin.id],
    );

    await removeProjectStaff(admin, projectId, projectStaffId);

    const result = await ownerPool.query<{
      assignee_id: string | null;
      assignment_count: string;
    }>(
      `SELECT
         request."assigneeId" AS assignee_id,
         (SELECT COUNT(*)::text FROM "RequestAssignee"
           WHERE "serviceRequestId" = request.id
             AND "userId" = $2) AS assignment_count
       FROM "ServiceRequest" request
       WHERE request.id = $1`,
      [created.id, removableUserId],
    );
    expect(result.rows[0]).toEqual({
      assignee_id: null,
      assignment_count: "0",
    });
  });

  it("已解决请求到期后会独立自动关闭并保持幂等", async () => {
    const created = await createFixtureRequest("自动关闭");
    await addRequestMessage(technician, created.id, {
      body: "<p>技术员开始处理。</p>",
      visibility: "CUSTOMER_VISIBLE",
    });
    await changeRequestStatus(technician, created.id, "RESOLVED");
    const resolvedAt = new Date("2026-07-10T00:00:00.000Z");
    const sweepAt = new Date("2026-07-23T00:00:00.000Z");
    await ownerPool.query(
      `UPDATE "ServiceRequest" SET "resolvedAt" = $2 WHERE id = $1`,
      [created.id, resolvedAt],
    );

    const first = await closeResolvedRequestsDue(sweepAt);
    expect(first.failedCount).toBe(0);

    const result = await ownerPool.query<{
      status: string;
      closed_at: string | null;
      system_message_count: string;
      audit_count: string;
      event_count: string;
    }>(
      `SELECT
         request.status::text,
         request."closedAt"::text AS closed_at,
         (SELECT COUNT(*)::text
            FROM "RequestMessage" message
           WHERE message."serviceRequestId" = request.id
             AND message."isSystem" = true
             AND message.body LIKE '%系统已自动关闭%') AS system_message_count,
         (SELECT COUNT(*)::text
            FROM "AuditLog" audit
           WHERE audit."serviceRequestId" = request.id
             AND audit.metadata->>'source' = 'AUTO_CLOSE_AFTER_RESOLUTION') AS audit_count,
         (SELECT COUNT(*)::text
            FROM "EventRecord" event
           WHERE event."serviceRequestId" = request.id
             AND event.payload->>'source' = 'AUTO_CLOSE_AFTER_RESOLUTION') AS event_count
       FROM "ServiceRequest" request
       WHERE request.id = $1`,
      [created.id],
    );
    expect(result.rows[0]).toMatchObject({
      status: "CLOSED",
      closed_at: "2026-07-23 00:00:00",
      system_message_count: "1",
      audit_count: "1",
    });
    expect(Number(result.rows[0]?.event_count ?? 0)).toBeGreaterThan(0);

    await closeResolvedRequestsDue(sweepAt);
    const duplicateCheck = await ownerPool.query<{
      system_message_count: string;
      audit_count: string;
    }>(
      `SELECT
         (SELECT COUNT(*)::text FROM "RequestMessage"
           WHERE "serviceRequestId" = $1
             AND "isSystem" = true
             AND body LIKE '%系统已自动关闭%') AS system_message_count,
         (SELECT COUNT(*)::text FROM "AuditLog"
           WHERE "serviceRequestId" = $1
             AND metadata->>'source' = 'AUTO_CLOSE_AFTER_RESOLUTION') AS audit_count`,
      [created.id],
    );
    expect(duplicateCheck.rows[0]).toEqual({
      system_message_count: "1",
      audit_count: "1",
    });
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

  it("自动状态变化不写系统消息，公开回复通知保留消息级来源", async () => {
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
      source_count: string;
      bodies: string[];
      max_occurrence_count: number;
      status_system_count: string;
    }>(
      `
        SELECT
          COUNT(*)::text AS notification_count,
          COUNT(DISTINCT notification."sourceId")::text AS source_count,
          ARRAY_AGG(notification.body ORDER BY notification."createdAt") AS bodies,
          MAX(notification."occurrenceCount") AS max_occurrence_count,
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
      `,
      [technician.id, created.id],
    );
    expect(result.rows[0]).toEqual({
      notification_count: "2",
      source_count: "2",
      bodies: ["第一条客户补充内容", "第二条客户补充内容"],
      max_occurrence_count: 1,
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
    ).toEqual({ counterpartOnline: false, counterpartClients: [] });
    expect(
      await updateRequestPresence(technician, created.id, {
        sessionId: staffSessionA,
        action: "heartbeat",
      }),
    ).toEqual({ counterpartOnline: true, counterpartClients: ["WEB"] });
    await updateRequestPresence(technician, created.id, {
      sessionId: staffSessionB,
      action: "heartbeat",
    });
    expect(
      await updateRequestPresence(customer, created.id, {
        sessionId: customerSession,
        action: "heartbeat",
      }),
    ).toEqual({ counterpartOnline: true, counterpartClients: ["WEB"] });

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
    ).toEqual({ counterpartOnline: true, counterpartClients: ["WEB"] });
    await updateRequestPresence(technician, created.id, {
      sessionId: staffSessionB,
      action: "leave",
    });
    expect(
      await updateRequestPresence(customer, created.id, {
        sessionId: customerSession,
        action: "heartbeat",
      }),
    ).toEqual({ counterpartOnline: false, counterpartClients: [] });
    await updateRequestPresence(customer, created.id, {
      sessionId: customerSession,
      action: "leave",
    });
  });

  it("保留期清理要真能删掉平台用户的行（RLS 会静默吞掉直接 deleteMany）", async () => {
    const { cleanupExpiredRequestPresence } = await import(
      "@/modules/requests/presence-sweep-service"
    );
    const staleId = randomUUID();
    const freshId = randomUUID();
    const created = await createFixtureRequest("保留期清理");
    // 一条早已过保留期的，一条刚离线的
    await ownerPool.query(
      `INSERT INTO "RequestPresence" (
         id, "serviceRequestId", "userId", "sessionId", "expiresAt", "updatedAt"
       ) VALUES
         ($1, $3, $4, $1, NOW() - INTERVAL '48 hours', NOW() - INTERVAL '48 hours'),
         ($2, $3, $4, $2, NOW(), NOW())`,
      [staleId, freshId, created.id, customer.id],
    );

    await cleanupExpiredRequestPresence();

    const rows = await ownerPool.query<{ id: string }>(
      `SELECT id FROM "RequestPresence" WHERE id = ANY($1::text[])`,
      [[staleId, freshId]],
    );
    const remaining = rows.rows.map((row) => row.id);
    // 过了保留期的必须真被删掉 —— 直接 deleteMany 会被 request_presence_delete
    // 策略（userId = app_user_id()）静默过滤成 0 行，任务白跑
    expect(remaining).not.toContain(staleId);
    // 刚离线的要留着，「客户设备与网络」还要靠它
    expect(remaining).toContain(freshId);

    await ownerPool.query('DELETE FROM "RequestPresence" WHERE id = ANY($1::text[])', [
      [staleId, freshId],
    ]);
  });

  it("离开工单只标离线，不抹掉设备记录", async () => {
    const created = await createFixtureRequest("离线保留设备");
    const sessionId = randomUUID();
    await updateRequestPresence(customer, created.id, {
      sessionId,
      action: "heartbeat",
      client: "MINIAPP",
      timezone: "Asia/Shanghai",
    });
    await updateRequestPresence(customer, created.id, {
      sessionId,
      action: "leave",
    });

    // 「客户设备与网络」就是从这张表读的：leave 直接删行的话，客户一关页面
    // 后台只剩「还没有打开过这个工单」—— 而那恰恰是最需要查的时候
    const row = await ownerPool.query<{
      client: string;
      timezone: string | null;
      online: boolean;
    }>(
      `SELECT client::text AS client, timezone, ("expiresAt" > NOW()) AS online
         FROM "RequestPresence"
        WHERE "serviceRequestId" = $1 AND "sessionId" = $2`,
      [created.id, sessionId],
    );
    expect(row.rowCount).toBe(1);
    expect(row.rows[0]?.client).toBe("MINIAPP");
    expect(row.rows[0]?.timezone).toBe("Asia/Shanghai");
    // 但必须已判定为离线，不能还算在线
    expect(row.rows[0]?.online).toBe(false);

    const after = await updateRequestPresence(technician, created.id, {
      sessionId: randomUUID(),
      action: "heartbeat",
    });
    expect(after.counterpartOnline).toBe(false);
    expect(after.counterpartClients).toEqual([]);
  });

  it("在线端按来源区分，同一分组的多个端会去重合并", async () => {
    const created = await createFixtureRequest("在线端区分");
    await addRequestMessage(technician, created.id, {
      body: "<p>接手在线端区分测试</p>",
      visibility: "CUSTOMER_VISIBLE",
    });
    const miniappSession = randomUUID();
    const webSession = randomUUID();
    const staffSession = randomUUID();

    // 客户只在小程序在线：员工侧看到的对端只有 MINIAPP
    await updateRequestPresence(customer, created.id, {
      sessionId: miniappSession,
      action: "heartbeat",
      client: "MINIAPP",
    });
    expect(
      await updateRequestPresence(technician, created.id, {
        sessionId: staffSession,
        action: "heartbeat",
      }),
    ).toEqual({ counterpartOnline: true, counterpartClients: ["MINIAPP"] });

    // 同一客户再开网页：两个端都要出现，且各自只出现一次
    await updateRequestPresence(customer, created.id, {
      sessionId: webSession,
      action: "heartbeat",
    });
    const both = await updateRequestPresence(technician, created.id, {
      sessionId: staffSession,
      action: "heartbeat",
    });
    expect(both.counterpartOnline).toBe(true);
    expect([...both.counterpartClients].sort()).toEqual(["MINIAPP", "WEB"]);

    // 小程序离线后只剩 WEB
    await updateRequestPresence(customer, created.id, {
      sessionId: miniappSession,
      action: "leave",
    });
    expect(
      await updateRequestPresence(technician, created.id, {
        sessionId: staffSession,
        action: "heartbeat",
      }),
    ).toEqual({ counterpartOnline: true, counterpartClients: ["WEB"] });

    for (const [actor, sessionId] of [
      [customer, webSession],
      [technician, staffSession],
    ] as const) {
      await updateRequestPresence(actor, created.id, {
        sessionId,
        action: "leave",
      });
    }
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
