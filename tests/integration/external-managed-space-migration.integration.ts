import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { assertIntegrationTestDatabase } from "./require-test-database";

assertIntegrationTestDatabase();

const pool = new Pool({
  connectionString: process.env.DATABASE_MIGRATION_URL,
  max: 1,
});

const migrationPath = resolve(
  process.cwd(),
  "prisma/migrations/20260717143000_external_managed_customer_spaces/migration.sql",
);
const migrationSql = readFileSync(migrationPath, "utf8");

const ids = {
  blockedSpace: randomUUID(),
  allowedSpace: randomUUID(),
  membership: randomUUID(),
  customerUser: randomUUID(),
  staffUser: "",
  projectBlocked: randomUUID(),
  projectAllowed: randomUUID(),
  request: randomUUID(),
  customerAttachment: randomUUID(),
  staffAttachment: randomUUID(),
};

let seed: {
  serviceTypeId: string;
  createdById: string;
} | null = null;

/**
 * Load the real migration DO block and scope it to one fixture project so we
 * execute the production SQL, not a reimplemented copy.
 */
function buildScopedMigrationSql(projectId: string) {
  const match = migrationSql.match(/DO \$\$[\s\S]*?END \$\$;/);
  if (!match) {
    throw new Error("migration.sql missing DO $$ block");
  }
  const scoped = match[0].replace(
    /WHERE p\.kind = 'EXTERNAL_INTEGRATION'\s+AND cs\.kind = 'STANDARD'/,
    `WHERE p.kind = 'EXTERNAL_INTEGRATION'
      AND cs.kind = 'STANDARD'
      AND p.id = '${projectId}'`,
  );
  if (scoped === match[0]) {
    throw new Error("failed to scope migration loop to fixture project id");
  }
  // The final safety check in the migration scans every EXTERNAL_INTEGRATION
  // row. Scope it as well so unrelated fixtures/shared data do not fail the test.
  const fullyScoped = scoped.replace(
    /WHERE p\.kind = 'EXTERNAL_INTEGRATION'\s+AND cs\.kind <> 'EXTERNAL_MANAGED'/,
    `WHERE p.kind = 'EXTERNAL_INTEGRATION'
      AND cs.kind <> 'EXTERNAL_MANAGED'
      AND p.id = '${projectId}'`,
  );
  if (fullyScoped === scoped) {
    throw new Error("failed to scope migration final safety check");
  }
  return fullyScoped;
}

beforeAll(async () => {
  const base = await pool.query<{
    serviceTypeId: string;
    createdById: string;
  }>(
    `
      SELECT
        project."serviceTypeId",
        project."createdById"
      FROM "Project" project
      LIMIT 1
    `,
  );
  seed = base.rows[0] ?? null;
  if (!seed) throw new Error("请先执行 pnpm test:integration:prepare");
  ids.staffUser = seed.createdById;

  await pool.query(
    `
      INSERT INTO "User" (
        id,
        name,
        email,
        "emailVerified",
        "platformRole",
        "updatedAt"
      )
      VALUES (
        $1,
        '迁移附件测试客户',
        $2,
        true,
        'CUSTOMER',
        NOW()
      )
    `,
    [
      ids.customerUser,
      `migration-customer-${ids.customerUser.slice(0, 8)}@example.test`,
    ],
  );

  for (const space of [
    {
      id: ids.blockedSpace,
      name: "迁移阻断标准空间",
      slug: `migration-blocked-${ids.blockedSpace.slice(0, 8)}`,
    },
    {
      id: ids.allowedSpace,
      name: "迁移放行标准空间",
      slug: `migration-allowed-${ids.allowedSpace.slice(0, 8)}`,
    },
  ]) {
    await pool.query(
      `
        INSERT INTO "CustomerSpace" (
          id,
          name,
          slug,
          kind,
          "memberLimit",
          status,
          "ownerId",
          "createdAt",
          "updatedAt"
        )
        VALUES (
          $1,
          $2,
          $3,
          'STANDARD',
          5,
          'ACTIVE',
          $4,
          NOW(),
          NOW()
        )
      `,
      [space.id, space.name, space.slug, ids.staffUser],
    );
  }

  await pool.query(
    `
      INSERT INTO "Membership" (
        id,
        "customerSpaceId",
        "userId",
        role,
        "createdAt",
        "updatedAt"
      )
      VALUES ($1, $2, $3, 'MEMBER', NOW(), NOW())
    `,
    [ids.membership, ids.blockedSpace, ids.customerUser],
  );

  await pool.query(
    `
      INSERT INTO "Project" (
        id,
        title,
        status,
        kind,
        "customerSpaceId",
        "serviceTypeId",
        "createdById",
        "updatedAt"
      )
      VALUES
        (
          $1,
          '迁移阻断-客户附件',
          'ACTIVE',
          'EXTERNAL_INTEGRATION',
          $3,
          $5,
          $6,
          NOW()
        ),
        (
          $2,
          '迁移放行-后台附件',
          'ACTIVE',
          'EXTERNAL_INTEGRATION',
          $4,
          $5,
          $6,
          NOW()
        )
    `,
    [
      ids.projectBlocked,
      ids.projectAllowed,
      ids.blockedSpace,
      ids.allowedSpace,
      seed.serviceTypeId,
      ids.staffUser,
    ],
  );

  await pool.query(
    `
      INSERT INTO "ServiceRequest" (
        id,
        number,
        title,
        description,
        priority,
        status,
        "projectId",
        "categoryId",
        "createdById",
        "updatedAt"
      )
      SELECT
        $1,
        $2,
        '后台创建的工单',
        '用于挂客户附件',
        'NORMAL',
        'PENDING',
        $3,
        category.id,
        $4,
        NOW()
      FROM "RequestCategory" category
      WHERE category."serviceTypeId" = $5
        AND category.active = true
      LIMIT 1
    `,
    [
      ids.request,
      `MIG-${ids.request.slice(0, 8)}`,
      ids.projectBlocked,
      ids.staffUser,
      seed.serviceTypeId,
    ],
  );

  await pool.query(
    `
      INSERT INTO "Attachment" (
        id,
        "originalName",
        "storageKey",
        "mimeType",
        size,
        visibility,
        "customerSpaceId",
        "projectId",
        "serviceRequestId",
        "uploadedById",
        "createdAt"
      )
      VALUES
        (
          $1,
          'customer.png',
          $2,
          'image/png',
          128,
          'CUSTOMER_VISIBLE',
          $4,
          $5,
          $6,
          $7,
          NOW()
        ),
        (
          $3,
          'staff.png',
          $8,
          'image/png',
          128,
          'CUSTOMER_VISIBLE',
          $9,
          $10,
          NULL,
          $11,
          NOW()
        )
    `,
    [
      ids.customerAttachment,
      `migration/customer-${ids.customerAttachment}.png`,
      ids.staffAttachment,
      ids.blockedSpace,
      ids.projectBlocked,
      ids.request,
      ids.customerUser,
      `migration/staff-${ids.staffAttachment}.png`,
      ids.allowedSpace,
      ids.projectAllowed,
      ids.staffUser,
    ],
  );
});

afterAll(async () => {
  await pool.query(`DELETE FROM "Attachment" WHERE id = ANY($1::text[])`, [
    [ids.customerAttachment, ids.staffAttachment],
  ]);
  await pool.query(`DELETE FROM "ServiceRequest" WHERE id = $1`, [ids.request]);
  await pool.query(`DELETE FROM "Project" WHERE id = ANY($1::text[])`, [
    [ids.projectBlocked, ids.projectAllowed],
  ]);
  await pool.query(`DELETE FROM "Membership" WHERE id = $1`, [ids.membership]);
  await pool.query(`DELETE FROM "CustomerSpace" WHERE id = ANY($1::text[])`, [
    [ids.blockedSpace, ids.allowedSpace],
  ]);
  await pool.query(`DELETE FROM "User" WHERE id = $1`, [ids.customerUser]);
  await pool.end();
});

describe("EXTERNAL_MANAGED 迁移", () => {
  it("migration 文件包含客户附件与 Membership 判定分支", () => {
    expect(migrationSql).toContain("formal_attachment_count");
    expect(migrationSql).toContain('a."uploadedById"');
    expect(migrationSql).toContain("attachments=%");
    expect(migrationSql).toContain('"Membership"');
    expect(migrationSql).toContain("ProjectUpdate");
    expect(migrationSql).toContain("UpdateComment");
  });

  it("执行真实 migration SQL 时，客户附件项目会被阻断", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await expect(
        client.query(buildScopedMigrationSql(ids.projectBlocked)),
      ).rejects.toThrow(/formal customer data detected/);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }

    const stillThere = await pool.query<{ kind: string; spaceId: string }>(
      `
        SELECT cs.kind, cs.id AS "spaceId"
        FROM "Project" p
        JOIN "CustomerSpace" cs ON cs.id = p."customerSpaceId"
        WHERE p.id = $1
      `,
      [ids.projectBlocked],
    );
    expect(stillThere.rows[0]).toEqual({
      kind: "STANDARD",
      spaceId: ids.blockedSpace,
    });
  });

  it("执行真实 migration SQL 时，仅后台附件的独立空间会放行", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(buildScopedMigrationSql(ids.projectAllowed));

      const moved = await client.query<{
        projectSpaceKind: string;
        attachmentSpaceKind: string;
        sameSpace: boolean;
        originalSpace: string | null;
      }>(
        `
          SELECT
            project_space.kind AS "projectSpaceKind",
            attachment_space.kind AS "attachmentSpaceKind",
            (project."customerSpaceId" = attachment."customerSpaceId") AS "sameSpace",
            (
              SELECT id
              FROM "CustomerSpace"
              WHERE id = $2
            ) AS "originalSpace"
          FROM "Project" project
          JOIN "CustomerSpace" project_space ON project_space.id = project."customerSpaceId"
          JOIN "Attachment" attachment ON attachment.id = $3
          JOIN "CustomerSpace" attachment_space ON attachment_space.id = attachment."customerSpaceId"
          WHERE project.id = $1
        `,
        [ids.projectAllowed, ids.allowedSpace, ids.staffAttachment],
      );

      expect(moved.rows[0]?.projectSpaceKind).toBe("EXTERNAL_MANAGED");
      expect(moved.rows[0]?.attachmentSpaceKind).toBe("EXTERNAL_MANAGED");
      expect(moved.rows[0]?.sameSpace).toBe(true);
      // Original STANDARD fixture space remains; project left it.
      expect(moved.rows[0]?.originalSpace).toBe(ids.allowedSpace);
      expect(moved.rows[0]?.projectSpaceKind).not.toBe("STANDARD");
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }

    const restored = await pool.query<{ kind: string; spaceId: string }>(
      `
        SELECT cs.kind, cs.id AS "spaceId"
        FROM "Project" p
        JOIN "CustomerSpace" cs ON cs.id = p."customerSpaceId"
        WHERE p.id = $1
      `,
      [ids.projectAllowed],
    );
    expect(restored.rows[0]).toEqual({
      kind: "STANDARD",
      spaceId: ids.allowedSpace,
    });
  });
});
