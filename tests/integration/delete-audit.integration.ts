import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import type { Actor } from "@/lib/actor";
import {
  readPrivateFile,
  removePrivateFile,
  writePrivateFile,
} from "@/modules/attachments/private-storage";
import { deleteCustomerSpace } from "@/modules/customer-spaces/customer-space-service";
import { routeError } from "@/modules/projects/api-utils";
import { deleteProject } from "@/modules/projects/project-service";

const ownerPool = new Pool({
  connectionString: process.env.DATABASE_MIGRATION_URL,
  max: 1,
});

const fixture = {
  projectSpaceId: randomUUID(),
  deletedSpaceId: randomUUID(),
  projectId: randomUUID(),
  storageKey: `projects/delete-audit-${randomUUID()}.txt`,
};

let admin: Actor;
let customerId: string;
let serviceTypeId: string;

beforeAll(async () => {
  const context = await ownerPool.query<{
    admin_id: string;
    admin_name: string;
    admin_email: string;
    admin_role: Actor["platformRole"];
    customer_id: string;
    service_type_id: string;
  }>(
    `
      SELECT
        admin.id AS admin_id,
        admin.name AS admin_name,
        admin.email AS admin_email,
        admin."platformRole" AS admin_role,
        customer.id AS customer_id,
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
    throw new Error("请先执行 pnpm db:seed 创建删除测试所需数据");
  }

  admin = {
    id: row.admin_id,
    name: row.admin_name,
    email: row.admin_email,
    platformRole: row.admin_role,
    isPlatformAdmin: true,
    isStaff: true,
  };
  customerId = row.customer_id;
  serviceTypeId = row.service_type_id;

  await createSpace(fixture.projectSpaceId, "project-delete");
  await createSpace(fixture.deletedSpaceId, "space-delete");
  await ownerPool.query(
    `
      INSERT INTO "Project" (
        id,
        title,
        "customerSpaceId",
        "serviceTypeId",
        "createdById",
        "updatedAt"
      )
      VALUES ($1, '删除审计集成测试', $2, $3, $4, NOW())
    `,
    [
      fixture.projectId,
      fixture.projectSpaceId,
      serviceTypeId,
      admin.id,
    ],
  );
  await writePrivateFile(
    fixture.storageKey,
    new TextEncoder().encode("delete audit fixture"),
  );
  await ownerPool.query(
    `
      INSERT INTO "Attachment" (
        id,
        "originalName",
        "storageKey",
        "mimeType",
        size,
        "customerSpaceId",
        "projectId",
        "uploadedById"
      )
      VALUES ($1, 'fixture.txt', $2, 'text/plain', 20, $3, $4, $5)
    `,
    [
      randomUUID(),
      fixture.storageKey,
      fixture.projectSpaceId,
      fixture.projectId,
      admin.id,
    ],
  );
});

afterAll(async () => {
  await ownerPool.query('DELETE FROM "Project" WHERE id = $1', [
    fixture.projectId,
  ]);
  await ownerPool.query(
    'DELETE FROM "CustomerSpace" WHERE id = ANY($1::text[])',
    [[fixture.projectSpaceId, fixture.deletedSpaceId]],
  );
  await ownerPool.query(
    'DELETE FROM "AuditLog" WHERE "resourceId" = ANY($1::text[])',
    [[fixture.projectId, fixture.deletedSpaceId]],
  );
  await removePrivateFile(fixture.storageKey);
  await ownerPool.end();
});

describe("删除操作审计", () => {
  it("删除项目后保留审计记录且不触发外键冲突", async () => {
    await deleteProject(admin, fixture.projectId);

    const result = await ownerPool.query<{
      project_count: string;
      audit_count: string;
      audit_project_id: string | null;
    }>(
      `
        SELECT
          (SELECT COUNT(*) FROM "Project" WHERE id = $1)::text AS project_count,
          (
            SELECT COUNT(*) FROM "AuditLog"
            WHERE action = 'PROJECT_DELETED' AND "resourceId" = $1
          )::text AS audit_count,
          (
            SELECT "projectId" FROM "AuditLog"
            WHERE action = 'PROJECT_DELETED' AND "resourceId" = $1
            ORDER BY id DESC
            LIMIT 1
          ) AS audit_project_id
      `,
      [fixture.projectId],
    );

    expect(result.rows[0]).toEqual({
      project_count: "0",
      audit_count: "1",
      audit_project_id: null,
    });
    await expect(readPrivateFile(fixture.storageKey)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("删除客户空间后保留审计记录且不触发外键冲突", async () => {
    await deleteCustomerSpace(admin, fixture.deletedSpaceId);

    const result = await ownerPool.query<{
      space_count: string;
      audit_count: string;
      audit_space_id: string | null;
    }>(
      `
        SELECT
          (
            SELECT COUNT(*) FROM "CustomerSpace" WHERE id = $1
          )::text AS space_count,
          (
            SELECT COUNT(*) FROM "AuditLog"
            WHERE action = 'CUSTOMER_SPACE_DELETED' AND "resourceId" = $1
          )::text AS audit_count,
          (
            SELECT "customerSpaceId" FROM "AuditLog"
            WHERE action = 'CUSTOMER_SPACE_DELETED' AND "resourceId" = $1
            ORDER BY id DESC
            LIMIT 1
          ) AS audit_space_id
      `,
      [fixture.deletedSpaceId],
    );

    expect(result.rows[0]).toEqual({
      space_count: "0",
      audit_count: "1",
      audit_space_id: null,
    });
  });
});

describe("Prisma 删除错误映射", () => {
  it("将外键冲突返回为可理解的 409", async () => {
    const response = routeError({ code: "P2003" });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "RELATION_CONFLICT",
        message: "关联数据不存在或仍在使用，无法完成当前操作",
      },
    });
  });

  it("将并发删除后的记录缺失返回为 404", async () => {
    const response = routeError({ code: "P2025" });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "NOT_FOUND",
        message: "记录不存在或已被删除",
      },
    });
  });
});

async function createSpace(id: string, slugPrefix: string) {
  await ownerPool.query(
    `
      INSERT INTO "CustomerSpace" (
        id,
        name,
        slug,
        "ownerId",
        "updatedAt"
      )
      VALUES ($1, '删除测试客户', $2, $3, NOW())
    `,
    [id, `${slugPrefix}-${randomUUID()}`, customerId],
  );
  await ownerPool.query(
    `
      INSERT INTO "Membership" (
        id,
        "customerSpaceId",
        "userId",
        role,
        "updatedAt"
      )
      VALUES ($1, $2, $3, 'OWNER', NOW())
    `,
    [randomUUID(), id, customerId],
  );
}
