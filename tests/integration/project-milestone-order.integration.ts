import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import type { Actor } from "@/lib/actor";
import { prisma } from "@/lib/db";
import { getProject } from "@/modules/projects/project-service";

const client = new Client({
  connectionString: process.env.DATABASE_MIGRATION_URL,
});

beforeAll(async () => {
  await client.connect();
});

afterAll(async () => {
  await client.end().catch(() => undefined);
  await prisma.$disconnect();
});

describe("项目详情里程碑排序", () => {
  it("新建的排在上面，即使删除过旧里程碑后 sortOrder 反而更小", async () => {
    const target = await client.query<{
      project_id: string;
      admin_id: string;
      admin_name: string;
      admin_email: string;
    }>(`
      SELECT project.id AS project_id, admin_user.id AS admin_id,
             admin_user.name AS admin_name, admin_user.email AS admin_email
      FROM "Project" project
      CROSS JOIN LATERAL (
        SELECT id, name, email FROM "User"
        WHERE "platformRole" = 'PLATFORM_ADMIN' ORDER BY id LIMIT 1
      ) admin_user
      ORDER BY project.id
      LIMIT 1
    `);
    const row = target.rows[0];
    expect(row).toBeTruthy();

    const older = randomUUID();
    const middle = randomUUID();
    const newest = randomUUID();
    // 模拟「建了 5 个、删掉前 2 个」：旧的 sortOrder=4，最新建的拿到 3
    const seeds: Array<[string, number, string]> = [
      [older, 4, "2030-01-01T00:00:00Z"],
      [middle, 4, "2030-01-02T00:00:00Z"],
      [newest, 3, "2030-01-03T00:00:00Z"],
    ];
    try {
      for (const [id, sortOrder, createdAt] of seeds) {
        await client.query(
          `INSERT INTO "Milestone" (
             id, title, status, "projectId", "createdById",
             "sortOrder", "createdAt", "updatedAt"
           ) VALUES ($1, $2, 'COMPLETED', $3, $4, $5, $6, NOW())`,
          [id, `order-${id}`, row!.project_id, row!.admin_id, sortOrder, createdAt],
        );
      }
      const actor: Actor = {
        id: row!.admin_id,
        name: row!.admin_name,
        email: row!.admin_email,
        platformRole: "PLATFORM_ADMIN",
        isPlatformAdmin: true,
        isStaff: true,
      };
      const project = await getProject(actor, row!.project_id);
      const ids = project.milestones
        .map((milestone) => milestone.id)
        .filter((id) => seeds.some(([seedId]) => seedId === id));
      expect(ids).toEqual([newest, middle, older]);
    } finally {
      await client.query('DELETE FROM "Milestone" WHERE id = ANY($1::text[])', [
        [older, middle, newest],
      ]);
    }
  });
});
