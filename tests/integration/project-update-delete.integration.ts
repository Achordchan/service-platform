import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import type { Actor } from "@/lib/actor";
import {
  readPrivateFile,
  removePrivateFile,
  writePrivateFile,
} from "@/modules/attachments/private-storage";
import { deleteProjectUpdate } from "@/modules/projects/project-update-service";

const ownerPool = new Pool({
  connectionString: process.env.DATABASE_MIGRATION_URL,
  max: 1,
});

const fixture = {
  spaceId: randomUUID(),
  projectId: randomUUID(),
  updateId: randomUUID(),
  commentId: randomUUID(),
  directAttachmentId: randomUUID(),
  commentAttachmentId: randomUUID(),
  directStorageKey: `projects/project-update-delete-${randomUUID()}.txt`,
  commentStorageKey: `projects/project-update-comment-delete-${randomUUID()}.txt`,
};

let admin: Actor;
let customer: Actor;

beforeAll(async () => {
  const context = await ownerPool.query<{
    admin_id: string;
    admin_name: string;
    admin_email: string;
    admin_role: Actor["platformRole"];
    customer_id: string;
    customer_name: string;
    customer_email: string;
    customer_role: Actor["platformRole"];
    service_type_id: string;
  }>(
    `
      SELECT
        admin.id AS admin_id,
        admin.name AS admin_name,
        admin.email AS admin_email,
        admin."platformRole" AS admin_role,
        customer.id AS customer_id,
        customer.name AS customer_name,
        customer.email AS customer_email,
        customer."platformRole" AS customer_role,
        service_type.id AS service_type_id
      FROM "User" admin
      CROSS JOIN "User" customer
      CROSS JOIN "ServiceType" service_type
      WHERE admin.email = 'admin@local.test'
        AND customer.email = 'client@local.test'
      LIMIT 1
    `,
  );
  const row = context.rows[0];
  if (!row) {
    throw new Error("请先执行 pnpm test:integration:prepare 创建进度删除测试数据");
  }

  admin = {
    id: row.admin_id,
    name: row.admin_name,
    email: row.admin_email,
    platformRole: row.admin_role,
    isPlatformAdmin: true,
    isStaff: true,
  };
  customer = {
    id: row.customer_id,
    name: row.customer_name,
    email: row.customer_email,
    platformRole: row.customer_role,
    isPlatformAdmin: false,
    isStaff: false,
  };

  await ownerPool.query(
    `INSERT INTO "CustomerSpace" (id, name, slug, "ownerId", "updatedAt")
     VALUES ($1, '进度删除测试客户', $2, $3, NOW())`,
    [fixture.spaceId, `project-update-delete-${randomUUID()}`, customer.id],
  );
  await ownerPool.query(
    `INSERT INTO "Membership" (id, "customerSpaceId", "userId", role, "updatedAt")
     VALUES ($1, $2, $3, 'OWNER', NOW())`,
    [randomUUID(), fixture.spaceId, customer.id],
  );
  await ownerPool.query(
    `INSERT INTO "Project" (
       id, title, "customerSpaceId", "serviceTypeId", "createdById", "updatedAt"
     ) VALUES ($1, '进度删除测试项目', $2, $3, $4, NOW())`,
    [fixture.projectId, fixture.spaceId, row.service_type_id, admin.id],
  );
  await ownerPool.query(
    `INSERT INTO "ProjectUpdate" (
       id, title, body, visibility, "projectId", "authorId", "updatedAt"
     ) VALUES ($1, '待删除进度', '<p>正文</p>', 'CUSTOMER_VISIBLE', $2, $3, NOW())`,
    [fixture.updateId, fixture.projectId, admin.id],
  );
  await ownerPool.query(
    `INSERT INTO "UpdateComment" (
       id, body, visibility, "projectUpdateId", "authorId", "updatedAt"
     ) VALUES ($1, '<p>评论</p>', 'CUSTOMER_VISIBLE', $2, $3, NOW())`,
    [fixture.commentId, fixture.updateId, customer.id],
  );

  await writePrivateFile(
    fixture.directStorageKey,
    new TextEncoder().encode("project update attachment"),
  );
  await writePrivateFile(
    fixture.commentStorageKey,
    new TextEncoder().encode("project update comment attachment"),
  );
  await ownerPool.query(
    `INSERT INTO "Attachment" (
       id, "originalName", "storageKey", "mimeType", size, inline,
       "customerSpaceId", "projectId", "projectUpdateId", "uploadedById"
     ) VALUES ($1, 'update.txt', $2, 'text/plain', 25, true, $3, $4, $5, $6)`,
    [
      fixture.directAttachmentId,
      fixture.directStorageKey,
      fixture.spaceId,
      fixture.projectId,
      fixture.updateId,
      admin.id,
    ],
  );
  await ownerPool.query(
    `INSERT INTO "Attachment" (
       id, "originalName", "storageKey", "mimeType", size, inline,
       "customerSpaceId", "projectId", "updateCommentId", "uploadedById"
     ) VALUES ($1, 'comment.txt', $2, 'text/plain', 33, true, $3, $4, $5, $6)`,
    [
      fixture.commentAttachmentId,
      fixture.commentStorageKey,
      fixture.spaceId,
      fixture.projectId,
      fixture.commentId,
      customer.id,
    ],
  );
});

afterAll(async () => {
  await ownerPool.query(
    `DELETE FROM "AuditLog" WHERE action = 'PROJECT_UPDATE_DELETED' AND "resourceId" = $1`,
    [fixture.updateId],
  );
  await ownerPool.query('DELETE FROM "CustomerSpace" WHERE id = $1', [
    fixture.spaceId,
  ]);
  await removePrivateFile(fixture.directStorageKey);
  await removePrivateFile(fixture.commentStorageKey);
  await ownerPool.end();
});

describe("删除项目进度", () => {
  it("拒绝客户删除进度", async () => {
    await expect(
      deleteProjectUpdate(customer, fixture.projectId, fixture.updateId),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("删除动态、评论、附件和文件，并记录审计与实时刷新事件", async () => {
    await expect(
      deleteProjectUpdate(admin, fixture.projectId, fixture.updateId),
    ).resolves.toEqual({ deleted: true });

    const records = await ownerPool.query<{
      updates: string;
      comments: string;
      attachments: string;
      audits: string;
      events: string;
    }>(
      `SELECT
         (SELECT COUNT(*) FROM "ProjectUpdate" WHERE id = $1)::text AS updates,
         (SELECT COUNT(*) FROM "UpdateComment" WHERE id = $2)::text AS comments,
         (SELECT COUNT(*) FROM "Attachment" WHERE id = ANY($3::text[]))::text AS attachments,
         (SELECT COUNT(*) FROM "AuditLog"
            WHERE action = 'PROJECT_UPDATE_DELETED' AND "resourceId" = $1)::text AS audits,
         (SELECT COUNT(*) FROM "EventRecord"
            WHERE "projectId" = $4
              AND type = 'PROJECT_UPDATED'
              AND payload->>'change' = 'PROJECT_UPDATE_DELETED'
              AND payload->>'projectUpdateId' = $1)::text AS events`,
      [
        fixture.updateId,
        fixture.commentId,
        [fixture.directAttachmentId, fixture.commentAttachmentId],
        fixture.projectId,
      ],
    );
    expect(records.rows[0]).toEqual({
      updates: "0",
      comments: "0",
      attachments: "0",
      audits: "1",
      events: "1",
    });
    await expect(readPrivateFile(fixture.directStorageKey)).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(readPrivateFile(fixture.commentStorageKey)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});
