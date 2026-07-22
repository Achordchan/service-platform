import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool, type PoolClient, type QueryResultRow } from "pg";
import type { Actor } from "@/lib/actor";
import { withActorDb } from "@/lib/actor";
import { prisma } from "@/lib/db";
import { readAttachmentDownload } from "@/modules/attachments/attachment-service";
import {
  claimSupportPlaybookInlineAttachments,
  claimUserInlineAttachments,
} from "@/modules/attachments/inline-attachment-service";
import {
  listVisibleEventBatch,
  listVisibleEvents,
} from "@/modules/notifications/notification-service";
import {
  getProjectProgress,
  listMilestones,
} from "@/modules/projects/milestone-service";
import { getProject } from "@/modules/projects/project-service";
import { listProjectUpdates } from "@/modules/projects/project-update-service";
import {
  getRequest,
  listProjectRequests,
} from "@/modules/requests/request-service";

type Fixture = {
  prefix: string;
  customerA: Actor;
  customerB: Actor;
  technician: Actor;
  admin: Actor;
  spaceAId: string;
  spaceBId: string;
  categoryAId: string;
  projectAId: string;
  projectBId: string;
  requestBId: string;
  assignedRequestAId: string;
  unassignedRequestAId: string;
  publicMessageAId: string;
  internalMessageAId: string;
  publicAttachmentAId: string;
  internalAttachmentAId: string;
  unassignedAttachmentAId: string;
  projectUpdateAId: string;
  projectAttachmentAId: string;
  eventCursor: bigint;
  eventAId: bigint;
  eventBId: bigint;
  targetedCrossTenantEventId: bigint;
  internalMessageEventId: bigint;
  fixtureStorageDir: string;
};

const ownerPool = new Pool({
  connectionString: pgConnectionString("DATABASE_MIGRATION_URL"),
  max: 2,
});
const appPool = new Pool({
  connectionString: pgConnectionString("DATABASE_URL"),
  max: 2,
});

let fixture: Fixture;
let appHadSchemaUsage = false;

beforeAll(async () => {
  const privilege = await ownerPool.query<{ allowed: boolean }>(
    "SELECT has_schema_privilege('service_platform_app', 'public', 'USAGE') AS allowed",
  );
  appHadSchemaUsage = privilege.rows[0]?.allowed === true;

  if (!appHadSchemaUsage) {
    await ownerPool.query("GRANT USAGE ON SCHEMA public TO service_platform_app");
  }

  fixture = await createFixture();
});

afterAll(async () => {
  if (fixture) {
    await cleanupFixture(fixture);
  }
  await prisma.$disconnect();
  await appPool.end();

  if (!appHadSchemaUsage) {
    await ownerPool.query("REVOKE USAGE ON SCHEMA public FROM service_platform_app");
  }
  await ownerPool.end();
});

describe("数据库运行角色基线", () => {
  it("应用角色具备访问 public schema 的 USAGE 权限", () => {
    expect(appHadSchemaUsage).toBe(true);
  });
});

describe("客户空间跨租户隔离", () => {
  it("客户可通过应用角色创建并返回自己的服务请求", async () => {
    const requestId = randomUUID();
    const rows = await queryAsActor<{ id: string }>(
      fixture.customerA,
      `
        INSERT INTO "ServiceRequest" (
          id, number, title, description, priority, status, "projectId",
          "categoryId", "createdById", "updatedAt"
        )
        VALUES (
          $1, $2, 'RLS 创建回归', '验证 INSERT RETURNING',
          'NORMAL', 'PENDING', $3, $4, $5, NOW()
        )
        RETURNING id
      `,
      [
        requestId,
        `RLS-${requestId}`,
        fixture.projectAId,
        fixture.categoryAId,
        fixture.customerA.id,
      ],
    );

    expect(rows).toEqual([{ id: requestId }]);
  });

  it("客户 B 可以读取自己的空间、项目和服务请求", async () => {
    const result = await queryAsActor<{
      space_count: string;
      project_count: string;
      request_count: string;
    }>(
      fixture.customerB,
      `
        SELECT
          (SELECT COUNT(*) FROM "CustomerSpace" WHERE id = $1)::text AS space_count,
          (SELECT COUNT(*) FROM "Project" WHERE id = $2)::text AS project_count,
          (SELECT COUNT(*) FROM "ServiceRequest" WHERE id = $3)::text AS request_count
      `,
      [fixture.spaceBId, fixture.projectBId, fixture.requestBId],
    );

    expect(result).toEqual([
      { space_count: "1", project_count: "1", request_count: "1" },
    ]);
  });

  it("RLS 不向客户 A 返回客户 B 的空间、项目和服务请求", async () => {
    const result = await queryAsActor<{
      space_count: string;
      project_count: string;
      request_count: string;
    }>(
      fixture.customerA,
      `
        SELECT
          (SELECT COUNT(*) FROM "CustomerSpace" WHERE id = $1)::text AS space_count,
          (SELECT COUNT(*) FROM "Project" WHERE id = $2)::text AS project_count,
          (SELECT COUNT(*) FROM "ServiceRequest" WHERE id = $3)::text AS request_count
      `,
      [fixture.spaceBId, fixture.projectBId, fixture.requestBId],
    );

    expect(result).toEqual([
      { space_count: "0", project_count: "0", request_count: "0" },
    ]);
  });

  it("领域服务拒绝客户 A 读取客户 B 的项目和请求", async () => {
    await expect(
      getProject(fixture.customerA, fixture.projectBId),
    ).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
    await expect(
      getRequest(fixture.customerA, fixture.requestBId),
    ).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
  });
});

describe("技术人员请求访问范围", () => {
  it("技术人员可以读取分配给自己的请求", async () => {
    const rows = await queryAsActor<{ id: string }>(
      fixture.technician,
      'SELECT id FROM "ServiceRequest" WHERE id = $1',
      [fixture.assignedRequestAId],
    );
    expect(rows).toEqual([{ id: fixture.assignedRequestAId }]);
  });

  it("RLS 向同项目技术人员开放未分配请求", async () => {
    const rows = await queryAsActor<{ id: string }>(
      fixture.technician,
      'SELECT id FROM "ServiceRequest" WHERE id = $1',
      [fixture.unassignedRequestAId],
    );
    expect(rows).toEqual([{ id: fixture.unassignedRequestAId }]);
  });

  it("领域服务详情和项目请求列表均展示未分配请求", async () => {
    const request = await getRequest(
      fixture.technician,
      fixture.unassignedRequestAId,
    );
    expect(request.id).toBe(fixture.unassignedRequestAId);

    const requests = await listProjectRequests(
      fixture.technician,
      fixture.projectAId,
    );
    expect(requests.map((item) => item.id)).toContain(
      fixture.unassignedRequestAId,
    );
  });
});

describe("INTERNAL 内容隔离", () => {
  it("领域服务只向客户返回 CUSTOMER_VISIBLE 消息和附件", async () => {
    const request = await getRequest(
      fixture.customerA,
      fixture.assignedRequestAId,
    );

    expect(request.messages.map((message) => message.id)).toContain(
      fixture.publicMessageAId,
    );
    expect(request.messages.map((message) => message.id)).not.toContain(
      fixture.internalMessageAId,
    );
    expect(request.attachments.map((attachment) => attachment.id)).toContain(
      fixture.publicAttachmentAId,
    );
    expect(request.attachments.map((attachment) => attachment.id)).not.toContain(
      fixture.internalAttachmentAId,
    );
  });

  it("RLS 本身不向客户返回 INTERNAL 消息", async () => {
    const rows = await queryAsActor<{
      id: string;
      visibility: "CUSTOMER_VISIBLE" | "INTERNAL";
    }>(
      fixture.customerA,
      `
        SELECT id, visibility
        FROM "RequestMessage"
        WHERE id = ANY($1::text[])
        ORDER BY id
      `,
      [[fixture.publicMessageAId, fixture.internalMessageAId]],
    );
    expect(rows).toEqual([
      {
        id: fixture.publicMessageAId,
        visibility: "CUSTOMER_VISIBLE",
      },
    ]);
  });

  it("RLS 本身不向客户返回 INTERNAL 附件元数据", async () => {
    const rows = await queryAsActor<{
      id: string;
      visibility: "CUSTOMER_VISIBLE" | "INTERNAL";
    }>(
      fixture.customerA,
      `
        SELECT id, visibility
        FROM "Attachment"
        WHERE id = ANY($1::text[])
        ORDER BY id
      `,
      [[fixture.publicAttachmentAId, fixture.internalAttachmentAId]],
    );
    expect(rows).toEqual([
      {
        id: fixture.publicAttachmentAId,
        visibility: "CUSTOMER_VISIBLE",
      },
    ]);
  });
});

describe("附件下载鉴权", () => {
  it("客户 A 可以下载自己空间内的公开附件", async () => {
    const download = await readAttachmentDownload(
      fixture.customerA,
      fixture.publicAttachmentAId,
    );
    expect(download.attachment.id).toBe(fixture.publicAttachmentAId);
    expect(download.buffer.toString("utf8")).toBe("public-a");
  });

  it("客户 A 不能下载同租户 INTERNAL 附件", async () => {
    await expect(
      readAttachmentDownload(
        fixture.customerA,
        fixture.internalAttachmentAId,
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
  });

  it("客户 B 不能下载客户 A 的公开附件", async () => {
    await expect(
      readAttachmentDownload(
        fixture.customerB,
        fixture.publicAttachmentAId,
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
  });

  it("技术人员可以下载未分配请求的公开附件以便接手", async () => {
    const result = await readAttachmentDownload(
      fixture.technician,
      fixture.unassignedAttachmentAId,
    );
    expect(result.attachment.id).toBe(fixture.unassignedAttachmentAId);
  });

  it("关闭服务请求模块后客户不能通过指南图片直链绕过", async () => {
    const attachmentId = randomUUID();
    const messageId = randomUUID();
    const storageKey = `integration/${fixture.prefix}/playbook-module.png`;
    await writeFile(
      path.join(fixture.fixtureStorageDir, "playbook-module.png"),
      Buffer.from("playbook-image"),
      { mode: 0o600 },
    );
    await ownerPool.query(
      `
        INSERT INTO "Attachment" (
          id, "originalName", "storageKey", "mimeType", size, visibility,
          inline, "supportPlaybookKey", "uploadedById"
        ) VALUES (
          $1, 'playbook-module.png', $2, 'image/png', 14,
          'CUSTOMER_VISIBLE', true, 'windows-quick-assist', $3
        )
      `,
      [attachmentId, storageKey, fixture.admin.id],
    );
    await ownerPool.query(
      `
        INSERT INTO "RequestMessage" (
          id, body, visibility, "serviceRequestId", "authorId",
          "supportPlaybookKey", "supportPlaybookSnapshot", "updatedAt"
        ) VALUES (
          $1, '<p>处理指南</p>', 'CUSTOMER_VISIBLE', $2, $3,
          'windows-quick-assist', $4::jsonb, NOW()
        )
      `,
      [
        messageId,
        fixture.assignedRequestAId,
        fixture.technician.id,
        JSON.stringify({
          key: "windows-quick-assist",
          category: "REMOTE",
          title: "Windows 快速助手",
          summary: "测试",
          introduction: "测试",
          content: `<p><img src="attachment://${attachmentId}" data-attachment-id="${attachmentId}" alt="测试"></p>`,
          steps: ["测试"],
          safetyNotes: [],
        }),
      ],
    );
    await ownerPool.query(
      `UPDATE "Project" SET "customerRequestsEnabled" = false, "updatedAt" = NOW() WHERE id = $1`,
      [fixture.projectAId],
    );

    try {
      await expect(
        readAttachmentDownload(fixture.customerA, attachmentId),
      ).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
    } finally {
      await ownerPool.query(
        `UPDATE "Project" SET "customerRequestsEnabled" = true, "updatedAt" = NOW() WHERE id = $1`,
        [fixture.projectAId],
      );
      await ownerPool.query('DELETE FROM "RequestMessage" WHERE id = $1', [
        messageId,
      ]);
      await ownerPool.query('DELETE FROM "Attachment" WHERE id = $1', [
        attachmentId,
      ]);
    }
  });
});

describe("正文图片认领隔离", () => {
  it("不能把同项目其他用户的未发送图片认领到自己的内容", async () => {
    const foreignAttachmentId = randomUUID();
    const ownAttachmentId = randomUUID();
    await ownerPool.query(
      `
        INSERT INTO "Attachment" (
          id, "originalName", "storageKey", "mimeType", size, visibility,
          inline, "customerSpaceId", "projectId", "uploadedById"
        ) VALUES
          ($1, 'foreign.png', $3, 'image/png', 1, 'CUSTOMER_VISIBLE', true, $5, $6, $7),
          ($2, 'own.png', $4, 'image/png', 1, 'CUSTOMER_VISIBLE', true, $5, $6, $8)
      `,
      [
        foreignAttachmentId,
        ownAttachmentId,
        `integration/${fixture.prefix}/foreign-${foreignAttachmentId}.png`,
        `integration/${fixture.prefix}/own-${ownAttachmentId}.png`,
        fixture.spaceAId,
        fixture.projectAId,
        fixture.customerA.id,
        fixture.technician.id,
      ],
    );

    try {
      await expect(
        withActorDb(fixture.technician, (tx) =>
          claimUserInlineAttachments(tx, fixture.technician, [foreignAttachmentId], {
            projectId: fixture.projectAId,
            projectUpdateId: fixture.projectUpdateAId,
            visibility: "CUSTOMER_VISIBLE",
          }),
        ),
      ).rejects.toMatchObject({ code: "INLINE_IMAGE_UNAVAILABLE", status: 409 });

      await expect(
        withActorDb(fixture.technician, (tx) =>
          claimUserInlineAttachments(tx, fixture.technician, [ownAttachmentId], {
            projectId: fixture.projectAId,
            projectUpdateId: fixture.projectUpdateAId,
            visibility: "CUSTOMER_VISIBLE",
          }),
        ),
      ).resolves.toBeUndefined();
      const rows = await ownerPool.query<{ projectUpdateId: string | null }>(
        `SELECT "projectUpdateId" FROM "Attachment" WHERE id = $1`,
        [ownAttachmentId],
      );
      expect(rows.rows[0]?.projectUpdateId).toBe(fixture.projectUpdateAId);
    } finally {
      await ownerPool.query('DELETE FROM "Attachment" WHERE id = ANY($1::text[])', [
        [foreignAttachmentId, ownAttachmentId],
      ]);
    }
  });

  it("平台管理员可以保留其他管理员已归属当前指南的图片", async () => {
    const secondAdminId = randomUUID();
    const attachmentId = randomUUID();
    const secondAdmin = toActor({
      id: secondAdminId,
      name: "集成测试第二管理员",
      email: `${fixture.prefix}-admin@local.test`,
      platformRole: "PLATFORM_ADMIN",
    });
    await ownerPool.query(
      `INSERT INTO "User" (id, name, email, "emailVerified", "platformRole", "updatedAt") VALUES ($1, $2, $3, true, 'PLATFORM_ADMIN', NOW())`,
      [secondAdmin.id, secondAdmin.name, secondAdmin.email],
    );
    await ownerPool.query(
      `
        INSERT INTO "Attachment" (
          id, "originalName", "storageKey", "mimeType", size, visibility,
          inline, "supportPlaybookKey", "uploadedById"
        ) VALUES (
          $1, 'shared-guide.png', $2, 'image/png', 1,
          'CUSTOMER_VISIBLE', true, 'windows-quick-assist', $3
        )
      `,
      [
        attachmentId,
        `integration/${fixture.prefix}/shared-guide-${attachmentId}.png`,
        fixture.admin.id,
      ],
    );

    try {
      await expect(
        withActorDb(secondAdmin, (tx) =>
          claimSupportPlaybookInlineAttachments(
            tx,
            secondAdmin,
            [attachmentId],
            "windows-quick-assist",
          ),
        ),
      ).resolves.toBeUndefined();
    } finally {
      await ownerPool.query('DELETE FROM "Attachment" WHERE id = $1', [
        attachmentId,
      ]);
      await ownerPool.query('DELETE FROM "User" WHERE id = $1', [secondAdmin.id]);
    }
  });
});

describe("客户项目模块开关", () => {
  it("关闭后客户无法通过预加载、直链或附件接口绕过", async () => {
    await ownerPool.query(
      `
        UPDATE "Project"
        SET
          "customerUpdatesEnabled" = false,
          "customerRequestsEnabled" = false,
          "customerFilesEnabled" = false,
          "showMilestones" = false,
          "showProgress" = false,
          "updatedAt" = NOW()
        WHERE id = $1
      `,
      [fixture.projectAId],
    );

    try {
      const customerProject = await getProject(
        fixture.customerA,
        fixture.projectAId,
      );
      expect(customerProject.updates).toEqual([]);
      expect(customerProject.attachments).toEqual([]);
      expect(customerProject.milestones).toEqual([]);
      expect(customerProject.progress).toBe(0);
      await expect(
        listProjectUpdates(fixture.customerA, fixture.projectAId),
      ).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
      await expect(
        listProjectRequests(fixture.customerA, fixture.projectAId),
      ).resolves.toEqual([]);
      await expect(
        getRequest(fixture.customerA, fixture.assignedRequestAId),
      ).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
      await expect(
        listMilestones(fixture.customerA, fixture.projectAId),
      ).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
      await expect(
        getProjectProgress(fixture.customerA, fixture.projectAId),
      ).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
      await expect(
        readAttachmentDownload(
          fixture.customerA,
          fixture.projectAttachmentAId,
        ),
      ).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
      const hiddenRows = await queryAsActor<{
        request_count: string;
        update_count: string;
        milestone_count: string;
        attachment_count: string;
      }>(
        fixture.customerA,
        `
          SELECT
            (SELECT COUNT(*) FROM "ServiceRequest"
              WHERE "projectId" = $1)::text AS request_count,
            (SELECT COUNT(*) FROM "ProjectUpdate"
              WHERE "projectId" = $1)::text AS update_count,
            (SELECT COUNT(*) FROM "Milestone"
              WHERE "projectId" = $1)::text AS milestone_count,
            (SELECT COUNT(*) FROM "Attachment"
              WHERE id = ANY($2::text[]))::text AS attachment_count
        `,
        [
          fixture.projectAId,
          [fixture.publicAttachmentAId, fixture.projectAttachmentAId],
        ],
      );
      expect(hiddenRows).toEqual([
        {
          request_count: "0",
          update_count: "0",
          milestone_count: "0",
          attachment_count: "0",
        },
      ]);
      await expect(
        queryAsActor(
          fixture.customerA,
          `UPDATE "Project"
             SET "customerRequestsEnabled" = true, "updatedAt" = NOW()
           WHERE id = $1`,
          [fixture.projectAId],
        ),
      ).rejects.toThrow();
      const customerEvents = await listVisibleEvents(
        fixture.customerA,
        fixture.eventCursor,
      );
      expect(customerEvents.map((event) => BigInt(event.id))).not.toContain(
        fixture.eventAId,
      );

      const staffProject = await getProject(
        fixture.technician,
        fixture.projectAId,
      );
      expect(staffProject.updates.map((item) => item.id)).toContain(
        fixture.projectUpdateAId,
      );
      expect(staffProject.attachments.map((item) => item.id)).toContain(
        fixture.projectAttachmentAId,
      );
      await expect(
        getRequest(fixture.technician, fixture.assignedRequestAId),
      ).resolves.toMatchObject({ id: fixture.assignedRequestAId });
      await expect(
        readAttachmentDownload(
          fixture.technician,
          fixture.projectAttachmentAId,
        ),
      ).resolves.toMatchObject({
        attachment: { id: fixture.projectAttachmentAId },
      });
    } finally {
      await ownerPool.query(
        `
          UPDATE "Project"
          SET
            "customerUpdatesEnabled" = true,
            "customerRequestsEnabled" = true,
            "customerFilesEnabled" = true,
            "showMilestones" = true,
            "showProgress" = true,
            "updatedAt" = NOW()
          WHERE id = $1
        `,
        [fixture.projectAId],
      );
    }
  });

  it("仅开放进度时不向客户返回里程碑明细", async () => {
    const milestoneId = randomUUID();
    await ownerPool.query(
      `
        INSERT INTO "Milestone" (
          id, title, status, "projectId", "createdById", "updatedAt"
        ) VALUES ($1, '仅进度可见的里程碑', 'IN_PROGRESS', $2, $3, NOW())
      `,
      [milestoneId, fixture.projectAId, fixture.technician.id],
    );
    await ownerPool.query(
      `UPDATE "Project" SET "showMilestones" = false, "showProgress" = true, "updatedAt" = NOW() WHERE id = $1`,
      [fixture.projectAId],
    );

    try {
      const progress = await getProjectProgress(
        fixture.customerA,
        fixture.projectAId,
      );
      expect(progress.milestones).toEqual([]);
      expect(progress.counts.total).toBeGreaterThan(0);
      await expect(
        listMilestones(fixture.customerA, fixture.projectAId),
      ).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });

      const staffProgress = await getProjectProgress(
        fixture.technician,
        fixture.projectAId,
      );
      expect(staffProgress.milestones.map((item) => item.id)).toContain(
        milestoneId,
      );
    } finally {
      await ownerPool.query('DELETE FROM "Milestone" WHERE id = $1', [
        milestoneId,
      ]);
      await ownerPool.query(
        `UPDATE "Project" SET "showMilestones" = true, "showProgress" = true, "updatedAt" = NOW() WHERE id = $1`,
        [fixture.projectAId],
      );
    }
  });
});

describe("SSE 断线补取事件筛选", () => {
  it("被关闭模块的事件达到单页上限时仍推进扫描游标", async () => {
    const cursorResult = await ownerPool.query<{ cursor: string }>(
      'SELECT COALESCE(MAX(id), 0)::text AS cursor FROM "EventRecord"',
    );
    const cursor = BigInt(cursorResult.rows[0]?.cursor ?? "0");
    await ownerPool.query(
      `UPDATE "Project" SET "customerUpdatesEnabled" = false, "updatedAt" = NOW() WHERE id = $1`,
      [fixture.projectAId],
    );

    const insertedEventIds: string[] = [];
    try {
      const hiddenResult = await ownerPool.query<{ id: string }>(
        `
          INSERT INTO "EventRecord" (
            type, payload, "customerSpaceId", "projectId"
          )
          SELECT
            'PROJECT_UPDATE_CREATED',
            jsonb_build_object('projectId', $1::text),
            $2,
            $1
          FROM generate_series(1, 100)
          RETURNING id::text
        `,
        [fixture.projectAId, fixture.spaceAId],
      );
      insertedEventIds.push(...hiddenResult.rows.map((row) => row.id));
      const visibleResult = await ownerPool.query<{ id: string }>(
        `
          INSERT INTO "EventRecord" (type, payload, "userId")
          VALUES ('PROJECT_UPDATED', '{}'::jsonb, $1)
          RETURNING id::text
        `,
        [fixture.customerA.id],
      );
      insertedEventIds.push(visibleResult.rows[0]!.id);
      const visibleEventId = BigInt(visibleResult.rows[0]!.id);

      const hiddenBatch = await listVisibleEventBatch(
        fixture.customerA,
        cursor,
      );
      expect(hiddenBatch.events).toEqual([]);
      expect(hiddenBatch.scannedCount).toBe(100);
      expect(hiddenBatch.nextCursor).toBeGreaterThan(cursor);

      const visibleBatch = await listVisibleEventBatch(
        fixture.customerA,
        hiddenBatch.nextCursor,
      );
      expect(visibleBatch.events.map((event) => BigInt(event.id))).toContain(
        visibleEventId,
      );
    } finally {
      if (insertedEventIds.length > 0) {
        await ownerPool.query(
          `DELETE FROM "EventRecord" WHERE id = ANY($1::bigint[])`,
          [insertedEventIds],
        );
      }
      await ownerPool.query(
        `UPDATE "Project" SET "customerUpdatesEnabled" = true, "updatedAt" = NOW() WHERE id = $1`,
        [fixture.projectAId],
      );
    }
  });

  it("客户 A 看不到普通的客户 B 事件", async () => {
    const events = await listVisibleEvents(
      fixture.customerA,
      fixture.eventCursor,
    );
    expect(events.map((event) => BigInt(event.id))).not.toContain(
      fixture.eventBId,
    );
    expect(events.map((event) => BigInt(event.id))).toContain(
      fixture.eventAId,
    );
  });

  it("即使 userId 误指向客户 A，也不能下发客户 B 的资源事件", async () => {
    const events = await listVisibleEvents(
      fixture.customerA,
      fixture.eventCursor,
    );
    expect(events.map((event) => BigInt(event.id))).not.toContain(
      fixture.targetedCrossTenantEventId,
    );
  });

  it("客户 SSE 不下发 INTERNAL 消息事件", async () => {
    const events = await listVisibleEvents(
      fixture.customerA,
      fixture.eventCursor,
    );
    expect(events.map((event) => BigInt(event.id))).not.toContain(
      fixture.internalMessageEventId,
    );
  });
});

describe("新增业务字段的数据库写保护", () => {
  it("正式客户不能绕过接口归档服务请求", async () => {
    await expect(
      queryAsActor(
        fixture.customerA,
        `UPDATE "ServiceRequest"
           SET "archivedAt" = NOW(), "updatedAt" = NOW()
         WHERE id = $1`,
        [fixture.assignedRequestAId],
      ),
    ).rejects.toThrow();
  });

  it("正式客户不能把工单附件改挂到里程碑", async () => {
    const milestoneId = randomUUID();
    await ownerPool.query(
      `
        INSERT INTO "Milestone" (
          id, title, status, "projectId", "createdById", "updatedAt"
        ) VALUES ($1, '附件归属保护', 'NOT_STARTED', $2, $3, NOW())
      `,
      [milestoneId, fixture.projectAId, fixture.technician.id],
    );
    try {
      await expect(
        queryAsActor(
          fixture.customerA,
          `UPDATE "Attachment"
             SET "milestoneId" = $1
           WHERE id = $2`,
          [milestoneId, fixture.publicAttachmentAId],
        ),
      ).rejects.toThrow();
    } finally {
      await ownerPool.query('DELETE FROM "Milestone" WHERE id = $1', [
        milestoneId,
      ]);
    }
  });
});

async function createFixture(): Promise<Fixture> {
  const prefix = `integration-${randomUUID()}`;
  const seedUsers = await ownerPool.query<{
    id: string;
    name: string;
    email: string;
    platformRole: Actor["platformRole"];
  }>(
    `
      SELECT id, name, email, "platformRole"
      FROM "User"
      WHERE email = ANY($1::text[])
    `,
    [
      [
        "admin@local.test",
        "tech@local.test",
        "client@local.test",
      ],
    ],
  );
  const users = new Map(seedUsers.rows.map((user) => [user.email, user]));
  const admin = requiredUser(users, "admin@local.test");
  const technician = toActor(requiredUser(users, "tech@local.test"));
  const customerA = toActor(requiredUser(users, "client@local.test"));

  const seed = await ownerPool.query<{
    space_id: string;
    project_id: string;
    service_type_id: string;
    category_id: string;
  }>(
    `
      SELECT
        space.id AS space_id,
        project.id AS project_id,
        project."serviceTypeId" AS service_type_id,
        category.id AS category_id
      FROM "CustomerSpace" space
      JOIN "Project" project ON project."customerSpaceId" = space.id
      JOIN "RequestCategory" category
        ON category."serviceTypeId" = project."serviceTypeId"
      WHERE space.slug = 'vision-tech'
        AND project.title = '官网 SEO 优化服务'
        AND category.active = true
      ORDER BY category."createdAt" ASC
      LIMIT 1
    `,
  );
  const seedData = seed.rows[0];
  if (!seedData) {
    throw new Error("缺少现有种子客户空间、项目或请求分类");
  }

  const ids = {
    customerBId: randomUUID(),
    spaceBId: randomUUID(),
    membershipBId: randomUUID(),
    projectBId: randomUUID(),
    requestBId: randomUUID(),
    assignedRequestAId: randomUUID(),
    unassignedRequestAId: randomUUID(),
    publicMessageAId: randomUUID(),
    internalMessageAId: randomUUID(),
    publicAttachmentAId: randomUUID(),
    internalAttachmentAId: randomUUID(),
    unassignedAttachmentAId: randomUUID(),
    projectUpdateAId: randomUUID(),
    projectAttachmentAId: randomUUID(),
  };
  const customerBEmail = `${prefix}@local.test`;
  const fixtureStorageDir = path.resolve(
    process.env.UPLOAD_DIR ?? ".data/uploads",
    "integration",
    prefix,
  );
  await mkdir(fixtureStorageDir, { recursive: true, mode: 0o700 });

  const files = {
    publicA: path.posix.join("integration", prefix, "public-a.txt"),
    internalA: path.posix.join("integration", prefix, "internal-a.txt"),
    unassignedA: path.posix.join("integration", prefix, "unassigned-a.txt"),
    projectA: path.posix.join("integration", prefix, "project-a.txt"),
  };
  await Promise.all([
    writeFile(path.join(fixtureStorageDir, "public-a.txt"), "public-a", {
      mode: 0o600,
    }),
    writeFile(path.join(fixtureStorageDir, "internal-a.txt"), "internal-a", {
      mode: 0o600,
    }),
    writeFile(
      path.join(fixtureStorageDir, "unassigned-a.txt"),
      "unassigned-a",
      { mode: 0o600 },
    ),
    writeFile(path.join(fixtureStorageDir, "project-a.txt"), "project-a", {
      mode: 0o600,
    }),
  ]);

  const client = await ownerPool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `
        INSERT INTO "User" (
          id, name, email, "emailVerified", "platformRole", "updatedAt"
        )
        VALUES ($1, '集成测试客户 B', $2, true, 'CUSTOMER', NOW())
      `,
      [ids.customerBId, customerBEmail],
    );
    await client.query(
      `
        INSERT INTO "CustomerSpace" (id, name, slug, "ownerId", "updatedAt")
        VALUES ($1, '集成测试空间 B', $2, $3, NOW())
      `,
      [ids.spaceBId, prefix, ids.customerBId],
    );
    await client.query(
      `
        INSERT INTO "Membership" (id, "customerSpaceId", "userId", role, "updatedAt")
        VALUES ($1, $2, $3, 'OWNER', NOW())
      `,
      [ids.membershipBId, ids.spaceBId, ids.customerBId],
    );
    await client.query(
      `
        INSERT INTO "Project" (
          id, title, status, "customerSpaceId", "serviceTypeId",
          "createdById", "updatedAt"
        )
        VALUES ($1, '集成测试项目 B', 'ACTIVE', $2, $3, $4, NOW())
      `,
      [
        ids.projectBId,
        ids.spaceBId,
        seedData.service_type_id,
        admin.id,
      ],
    );
    await insertRequest(client, {
      id: ids.requestBId,
      number: `${prefix}-B`,
      title: "客户 B 请求",
      projectId: ids.projectBId,
      categoryId: seedData.category_id,
      createdById: ids.customerBId,
      assigneeId: null,
    });
    await insertRequest(client, {
      id: ids.assignedRequestAId,
      number: `${prefix}-A-ASSIGNED`,
      title: "客户 A 已分配请求",
      projectId: seedData.project_id,
      categoryId: seedData.category_id,
      createdById: customerA.id,
      assigneeId: technician.id,
    });
    await insertRequest(client, {
      id: ids.unassignedRequestAId,
      number: `${prefix}-A-UNASSIGNED`,
      title: "客户 A 未分配请求",
      projectId: seedData.project_id,
      categoryId: seedData.category_id,
      createdById: customerA.id,
      assigneeId: null,
    });
    await client.query(
      `
        INSERT INTO "RequestMessage" (
          id, body, visibility, "serviceRequestId", "authorId", "updatedAt"
        )
        VALUES
          ($1, '公开回复', 'CUSTOMER_VISIBLE', $3, $4, NOW()),
          ($2, '内部备注机密内容', 'INTERNAL', $3, $5, NOW())
      `,
      [
        ids.publicMessageAId,
        ids.internalMessageAId,
        ids.assignedRequestAId,
        customerA.id,
        technician.id,
      ],
    );
    await client.query(
      `
        INSERT INTO "Attachment" (
          id, "originalName", "storageKey", "mimeType", size, visibility,
          "customerSpaceId", "projectId", "serviceRequestId",
          "requestMessageId", "uploadedById"
        )
        VALUES
          ($1, 'public-a.txt', $4, 'text/plain', 8, 'CUSTOMER_VISIBLE',
            $7, $8, $9, NULL, $11),
          ($2, 'internal-a.txt', $5, 'text/plain', 10, 'INTERNAL',
            $7, $8, $9, $10, $12),
          ($3, 'unassigned-a.txt', $6, 'text/plain', 12, 'CUSTOMER_VISIBLE',
            $7, $8, $13, NULL, $11)
      `,
      [
        ids.publicAttachmentAId,
        ids.internalAttachmentAId,
        ids.unassignedAttachmentAId,
        files.publicA,
        files.internalA,
        files.unassignedA,
        seedData.space_id,
        seedData.project_id,
        ids.assignedRequestAId,
        ids.internalMessageAId,
        customerA.id,
        technician.id,
        ids.unassignedRequestAId,
      ],
    );
    await client.query(
      `
        INSERT INTO "ProjectUpdate" (
          id, title, body, visibility, "projectId", "authorId", "updatedAt"
        )
        VALUES (
          $1, '客户模块开关测试动态', '公开项目动态',
          'CUSTOMER_VISIBLE', $2, $3, NOW()
        )
      `,
      [ids.projectUpdateAId, seedData.project_id, admin.id],
    );
    await client.query(
      `
        INSERT INTO "Attachment" (
          id, "originalName", "storageKey", "mimeType", size, visibility,
          "customerSpaceId", "projectId", "uploadedById"
        )
        VALUES (
          $1, 'project-a.txt', $2, 'text/plain', 9, 'CUSTOMER_VISIBLE',
          $3, $4, $5
        )
      `,
      [
        ids.projectAttachmentAId,
        files.projectA,
        seedData.space_id,
        seedData.project_id,
        admin.id,
      ],
    );

    const cursorResult = await client.query<{ cursor: string }>(
      'SELECT COALESCE(MAX(id), 0)::text AS cursor FROM "EventRecord"',
    );
    const eventCursor = BigInt(cursorResult.rows[0]?.cursor ?? "0");
    const eventAId = await insertEvent(client, {
      type: "REQUEST_MESSAGE_CREATED",
      payload: { marker: `${prefix}-event-a` },
      customerSpaceId: seedData.space_id,
      projectId: seedData.project_id,
      serviceRequestId: ids.assignedRequestAId,
    });
    const eventBId = await insertEvent(client, {
      type: "REQUEST_MESSAGE_CREATED",
      payload: { marker: `${prefix}-event-b` },
      customerSpaceId: ids.spaceBId,
      projectId: ids.projectBId,
      serviceRequestId: ids.requestBId,
    });
    const targetedCrossTenantEventId = await insertEvent(client, {
      type: "REQUEST_MESSAGE_CREATED",
      payload: { marker: `${prefix}-targeted-cross-tenant` },
      userId: customerA.id,
      customerSpaceId: ids.spaceBId,
      projectId: ids.projectBId,
      serviceRequestId: ids.requestBId,
    });
    const internalMessageEventId = await insertEvent(client, {
      type: "REQUEST_MESSAGE_CREATED",
      payload: {
        marker: `${prefix}-internal`,
        requestMessageId: ids.internalMessageAId,
        body: "内部备注机密内容",
        visibility: "INTERNAL",
      },
      customerSpaceId: seedData.space_id,
      projectId: seedData.project_id,
      serviceRequestId: ids.assignedRequestAId,
    });

    await client.query("COMMIT");

    return {
      prefix,
      admin: toActor(admin),
      customerA,
      customerB: {
        id: ids.customerBId,
        name: "集成测试客户 B",
        email: customerBEmail,
        platformRole: "CUSTOMER",
        isPlatformAdmin: false,
        isStaff: false,
      },
      technician,
      spaceAId: seedData.space_id,
      spaceBId: ids.spaceBId,
      categoryAId: seedData.category_id,
      projectAId: seedData.project_id,
      projectBId: ids.projectBId,
      requestBId: ids.requestBId,
      assignedRequestAId: ids.assignedRequestAId,
      unassignedRequestAId: ids.unassignedRequestAId,
      publicMessageAId: ids.publicMessageAId,
      internalMessageAId: ids.internalMessageAId,
      publicAttachmentAId: ids.publicAttachmentAId,
      internalAttachmentAId: ids.internalAttachmentAId,
      unassignedAttachmentAId: ids.unassignedAttachmentAId,
      projectUpdateAId: ids.projectUpdateAId,
      projectAttachmentAId: ids.projectAttachmentAId,
      eventCursor,
      eventAId,
      eventBId,
      targetedCrossTenantEventId,
      internalMessageEventId,
      fixtureStorageDir,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    await rm(fixtureStorageDir, { recursive: true, force: true });
    throw error;
  } finally {
    client.release();
  }
}

async function cleanupFixture(value: Fixture) {
  await ownerPool.query('DELETE FROM "Attachment" WHERE id = $1', [
    value.projectAttachmentAId,
  ]);
  await ownerPool.query('DELETE FROM "ProjectUpdate" WHERE id = $1', [
    value.projectUpdateAId,
  ]);
  await ownerPool.query(
    'DELETE FROM "ServiceRequest" WHERE id = ANY($1::text[])',
    [[value.assignedRequestAId, value.unassignedRequestAId]],
  );
  await ownerPool.query('DELETE FROM "CustomerSpace" WHERE id = $1', [
    value.spaceBId,
  ]);
  await ownerPool.query('DELETE FROM "User" WHERE id = $1', [
    value.customerB.id,
  ]);
  await rm(value.fixtureStorageDir, { recursive: true, force: true });
}

async function insertRequest(
  client: PoolClient,
  input: {
    id: string;
    number: string;
    title: string;
    projectId: string;
    categoryId: string;
    createdById: string;
    assigneeId: string | null;
  },
) {
  await client.query(
    `
      INSERT INTO "ServiceRequest" (
        id, number, title, description, priority, status, "projectId",
        "categoryId", "createdById", "assigneeId", "updatedAt"
      )
      VALUES ($1, $2, $3, '集成测试数据', 'NORMAL', 'IN_PROGRESS',
        $4, $5, $6, $7, NOW())
    `,
    [
      input.id,
      input.number,
      input.title,
      input.projectId,
      input.categoryId,
      input.createdById,
      input.assigneeId,
    ],
  );
}

async function insertEvent(
  client: PoolClient,
  input: {
    type: "REQUEST_MESSAGE_CREATED";
    payload: Record<string, unknown>;
    userId?: string;
    customerSpaceId: string;
    projectId: string;
    serviceRequestId: string;
  },
) {
  const result = await client.query<{ id: string }>(
    `
      INSERT INTO "EventRecord" (
        type, payload, "userId", "customerSpaceId", "projectId",
        "serviceRequestId"
      )
      VALUES ($1, $2::jsonb, $3, $4, $5, $6)
      RETURNING id::text
    `,
    [
      input.type,
      JSON.stringify(input.payload),
      input.userId ?? null,
      input.customerSpaceId,
      input.projectId,
      input.serviceRequestId,
    ],
  );
  return BigInt(result.rows[0]!.id);
}

async function queryAsActor<Row extends QueryResultRow>(
  actor: Actor,
  sql: string,
  params: unknown[] = [],
) {
  const client = await appPool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "SELECT set_config('app.user_id', $1, true)",
      [actor.id],
    );
    await client.query(
      "SELECT set_config('app.is_platform_admin', $1, true)",
      [String(actor.isPlatformAdmin)],
    );
    await client.query(
      "SELECT set_config('app.is_staff', $1, true)",
      [String(actor.isStaff)],
    );
    const result = await client.query<Row>(sql, params);
    await client.query("ROLLBACK");
    return result.rows;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function requiredUser<T>(
  users: Map<string, T>,
  email: string,
) {
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
