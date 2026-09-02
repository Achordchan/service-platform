import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";

const client = new Client({
  connectionString: process.env.DATABASE_MIGRATION_URL,
});

beforeAll(async () => {
  await client.connect();
});

afterAll(async () => {
  await client.end().catch(() => undefined);
});

describe("里程碑评论数据库安全", () => {
  it("MilestoneComment 显式启用 RLS，四条策略都存在", async () => {
    const table = await client.query<{
      relrowsecurity: boolean;
      policy_count: string;
    }>(`
      SELECT
        class.relrowsecurity,
        COUNT(policy.polname)::text AS policy_count
      FROM pg_class class
      JOIN pg_namespace namespace ON namespace.oid = class.relnamespace
      LEFT JOIN pg_policy policy ON policy.polrelid = class.oid
      WHERE namespace.nspname = 'public'
        AND class.relname = 'MilestoneComment'
      GROUP BY class.relrowsecurity
    `);

    expect(table.rows).toEqual([
      { relrowsecurity: true, policy_count: "4" },
    ]);
  });

  it("同时有 milestone/comment 归属时优先按评论门控，progress-only 仍放行", async () => {
    await client.query("BEGIN");
    try {
      const project = await client.query<{ id: string }>(`
        SELECT id FROM "Project" ORDER BY id LIMIT 1
      `);
      const projectId = project.rows[0]?.id;
      expect(projectId).toBeTruthy();

      await client.query(
        `UPDATE "Project"
         SET "showMilestones" = FALSE, "showProgress" = TRUE
         WHERE id = $1`,
        [projectId],
      );
      await client.query("SET LOCAL ROLE service_platform_app");
      await client.query(`SELECT set_config('app.user_id', 'rls-test', true)`);
      await client.query(`SELECT set_config('app.is_platform_admin', 'false', true)`);
      await client.query(`SELECT set_config('app.is_staff', 'false', true)`);

      const result = await client.query<{ allowed: boolean }>(
        `SELECT app_project_attachment_feature_enabled(
          $1, NULL, NULL, 'milestone-id', FALSE, 'milestone-comment-id'
        ) AS allowed`,
        [projectId],
      );
      expect(result.rows).toEqual([{ allowed: true }]);
    } finally {
      await client.query("ROLLBACK");
    }
  });
});
