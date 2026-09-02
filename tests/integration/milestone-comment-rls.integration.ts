import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import type { Actor } from "@/lib/actor";
import { withActorDb } from "@/lib/actor";
import { prisma } from "@/lib/db";
import { previewProjectActivityRecipients } from "@/modules/notifications/notification-service";
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

  it("progress-only 不暴露里程碑评论附件", async () => {
    await client.query("BEGIN");
    try {
      const target = await client.query<{
        milestone_id: string;
        project_id: string;
        customer_id: string;
      }>(`
        SELECT
          milestone.id AS milestone_id,
          project.id AS project_id,
          membership."userId" AS customer_id
        FROM "Milestone" milestone
        JOIN "Project" project ON project.id = milestone."projectId"
        JOIN "Membership" membership
          ON membership."customerSpaceId" = project."customerSpaceId"
        ORDER BY milestone.id, membership."userId"
        LIMIT 1
      `);
      const row = target.rows[0];
      expect(row).toBeTruthy();

      await client.query(
        `UPDATE "Project"
         SET "showMilestones" = FALSE, "showProgress" = TRUE
         WHERE id = $1`,
        [row!.project_id],
      );
      const commentId = `progress-comment-${Date.now()}`;
      await client.query(
        `INSERT INTO "MilestoneComment"
          (id, body, visibility, "milestoneId", "authorId", "updatedAt")
         VALUES ($1, '<p>public</p>', 'CUSTOMER_VISIBLE', $2, $3, NOW())`,
        [commentId, row!.milestone_id, row!.customer_id],
      );
      await client.query("SET LOCAL ROLE service_platform_app");
      await client.query(`SELECT set_config('app.user_id', $1, true)`, [
        row!.customer_id,
      ]);
      await client.query(`SELECT set_config('app.is_platform_admin', 'false', true)`);
      await client.query(`SELECT set_config('app.is_staff', 'false', true)`);

      const comments = await client.query<{ id: string }>(
        `SELECT id FROM "MilestoneComment" WHERE id = $1`,
        [commentId],
      );
      expect(comments.rows).toEqual([]);

      const result = await client.query<{ allowed: boolean }>(
        `SELECT app_project_attachment_feature_enabled(
          $1, NULL, NULL, $2, FALSE, $3
        ) AS allowed`,
        [row!.project_id, row!.milestone_id, commentId],
      );
      expect(result.rows).toEqual([{ allowed: false }]);
    } finally {
      await client.query("ROLLBACK");
    }
  });

  it("progress-only 不向客户预览里程碑评论通知", async () => {
    const target = await client.query<{
      project_id: string;
      customer_space_id: string;
      customer_id: string;
      admin_id: string;
      admin_name: string;
      admin_email: string;
      show_milestones: boolean;
      show_progress: boolean;
    }>(`
      SELECT
        project.id AS project_id,
        project."customerSpaceId" AS customer_space_id,
        membership."userId" AS customer_id,
        admin_user.id AS admin_id,
        admin_user.name AS admin_name,
        admin_user.email AS admin_email,
        project."showMilestones" AS show_milestones,
        project."showProgress" AS show_progress
      FROM "Project" project
      JOIN "Membership" membership
        ON membership."customerSpaceId" = project."customerSpaceId"
      CROSS JOIN LATERAL (
        SELECT id, name, email
        FROM "User"
        WHERE "platformRole" = 'PLATFORM_ADMIN'
        ORDER BY id
        LIMIT 1
      ) admin_user
      WHERE EXISTS (
        SELECT 1 FROM "Milestone" milestone
        WHERE milestone."projectId" = project.id
      )
      ORDER BY project.id, membership."userId"
      LIMIT 1
    `);
    const row = target.rows[0];
    expect(row).toBeTruthy();

    await client.query(
      `UPDATE "Project"
       SET "showMilestones" = FALSE, "showProgress" = TRUE
       WHERE id = $1`,
      [row!.project_id],
    );
    try {
      const adminActor: Actor = {
        id: row!.admin_id,
        name: row!.admin_name,
        email: row!.admin_email,
        platformRole: "PLATFORM_ADMIN",
        isPlatformAdmin: true,
        isStaff: true,
      };
      const preview = await withActorDb(adminActor, (tx) =>
        previewProjectActivityRecipients(tx, adminActor, {
          eventType: "PROJECT_UPDATED",
          eventPayload: {
            change: "MILESTONE_COMMENT_CREATED",
            projectId: row!.project_id,
            milestoneId: "milestone-1",
            milestoneCommentId: "comment-1",
          },
          notificationType: "UPDATE_COMMENT",
          notificationTitle: "项目里程碑有新评论",
          notificationBody: "项目里程碑收到了一条新评论。",
          visibility: "CUSTOMER_VISIBLE",
          customerSpaceId: row!.customer_space_id,
          projectId: row!.project_id,
        }),
      );
      expect(preview.notificationUserIds).not.toContain(row!.customer_id);
      expect(preview.emailUserIds).not.toContain(row!.customer_id);
    } finally {
      await client.query(
        `UPDATE "Project"
         SET "showMilestones" = $2, "showProgress" = $3
         WHERE id = $1`,
        [row!.project_id, row!.show_milestones, row!.show_progress],
      );
    }
  });

  it("客户不能用附件自身的公开可见性绕过内部父评论", async () => {
    await client.query("BEGIN");
    try {
      const target = await client.query<{
        milestone_id: string;
        project_id: string;
        customer_space_id: string;
        customer_id: string;
      }>(`
        SELECT
          milestone.id AS milestone_id,
          project.id AS project_id,
          project."customerSpaceId" AS customer_space_id,
          membership."userId" AS customer_id
        FROM "Milestone" milestone
        JOIN "Project" project ON project.id = milestone."projectId"
        JOIN "Membership" membership
          ON membership."customerSpaceId" = project."customerSpaceId"
        ORDER BY milestone.id, membership."userId"
        LIMIT 1
      `);
      const row = target.rows[0];
      expect(row).toBeTruthy();

      await client.query(
        `UPDATE "Project"
         SET "showMilestones" = TRUE, "showProgress" = TRUE
         WHERE id = $1`,
        [row!.project_id],
      );
      const commentId = `internal-comment-${Date.now()}`;
      const attachmentId = `internal-comment-file-${Date.now()}`;
      await client.query(
        `INSERT INTO "MilestoneComment"
          (id, body, visibility, "milestoneId", "authorId", "updatedAt")
         VALUES ($1, '<p>internal</p>', 'INTERNAL', $2, $3, NOW())`,
        [commentId, row!.milestone_id, row!.customer_id],
      );
      await client.query(
        `INSERT INTO "Attachment" (
          id, "originalName", "storageKey", "mimeType", size, visibility,
          "customerSpaceId", "projectId", "milestoneCommentId", "uploadedById"
        ) VALUES (
          $1, 'internal.txt', $2, 'text/plain', 8, 'CUSTOMER_VISIBLE',
          $3, $4, $5, $6
        )`,
        [
          attachmentId,
          `tests/${attachmentId}`,
          row!.customer_space_id,
          row!.project_id,
          commentId,
          row!.customer_id,
        ],
      );

      await client.query("SET LOCAL ROLE service_platform_app");
      await client.query(`SELECT set_config('app.user_id', $1, true)`, [
        row!.customer_id,
      ]);
      await client.query(`SELECT set_config('app.is_platform_admin', 'false', true)`);
      await client.query(`SELECT set_config('app.is_staff', 'false', true)`);

      const visible = await client.query<{ id: string }>(
        `SELECT id FROM "Attachment" WHERE id = $1`,
        [attachmentId],
      );
      expect(visible.rows).toEqual([]);
    } finally {
      await client.query("ROLLBACK");
    }
  });

  it("项目详情响应不序列化撤回里程碑下的评论正文", async () => {
    const target = await client.query<{
      milestone_id: string;
      project_id: string;
      customer_id: string;
      customer_name: string;
      customer_email: string;
      show_milestones: boolean;
      show_progress: boolean;
    }>(`
      SELECT
        milestone.id AS milestone_id,
        project.id AS project_id,
        membership."userId" AS customer_id,
        user_row.name AS customer_name,
        user_row.email AS customer_email,
        project."showMilestones" AS show_milestones,
        project."showProgress" AS show_progress
      FROM "Milestone" milestone
      JOIN "Project" project ON project.id = milestone."projectId"
      JOIN "Membership" membership
        ON membership."customerSpaceId" = project."customerSpaceId"
      JOIN "User" user_row ON user_row.id = membership."userId"
      WHERE NOT EXISTS (
        SELECT 1
        FROM "ContentRiskState" risk
        WHERE risk."targetType" = 'MILESTONE'
          AND risk."targetId" = milestone.id
      )
      ORDER BY milestone.id, membership."userId"
      LIMIT 1
    `);
    const row = target.rows[0];
    expect(row).toBeTruthy();

    const commentId = `revoked-parent-comment-${Date.now()}`;
    const riskStateId = `revoked-parent-state-${Date.now()}`;
    await client.query(
      `UPDATE "Project"
       SET "showMilestones" = TRUE, "showProgress" = TRUE
       WHERE id = $1`,
      [row!.project_id],
    );
    await client.query(
      `INSERT INTO "MilestoneComment"
        (id, body, visibility, "milestoneId", "authorId", "updatedAt")
       VALUES ($1, '<p>must-not-leak</p>', 'CUSTOMER_VISIBLE', $2, $3, NOW())`,
      [commentId, row!.milestone_id, row!.customer_id],
    );
    await client.query(
      `INSERT INTO "ContentRiskState" (
        id, "targetType", "targetId", "displayState", "revokedAt", "updatedAt"
      ) VALUES ($1, 'MILESTONE', $2, 'REVOKED', NOW(), NOW())`,
      [riskStateId, row!.milestone_id],
    );

    try {
      const customerActor: Actor = {
        id: row!.customer_id,
        name: row!.customer_name,
        email: row!.customer_email,
        platformRole: "CUSTOMER",
        isPlatformAdmin: false,
        isStaff: false,
      };
      const project = await getProject(customerActor, row!.project_id);
      const milestone = project.milestones.find(
        (item) => item.id === row!.milestone_id,
      );
      expect(milestone).toBeTruthy();
      expect(milestone?.contentRiskStatus).toBe("REVOKED");
      expect(milestone?.comments).toEqual([]);
      expect(JSON.stringify(milestone)).not.toContain("must-not-leak");
    } finally {
      await client.query(`DELETE FROM "ContentRiskState" WHERE id = $1`, [
        riskStateId,
      ]);
      await client.query(`DELETE FROM "MilestoneComment" WHERE id = $1`, [
        commentId,
      ]);
      await client.query(
        `UPDATE "Project"
         SET "showMilestones" = $2, "showProgress" = $3
         WHERE id = $1`,
        [row!.project_id, row!.show_milestones, row!.show_progress],
      );
    }
  });

  it("平台管理员只在风控快照事务中可回写他人评论", async () => {
    await client.query("BEGIN");
    try {
      const target = await client.query<{
        milestone_id: string;
        author_id: string;
      }>(`
        SELECT
          milestone.id AS milestone_id,
          user_row.id AS author_id
        FROM "Milestone" milestone
        CROSS JOIN "User" user_row
        ORDER BY milestone.id, user_row.id
        LIMIT 1
      `);
      const row = target.rows[0];
      expect(row).toBeTruthy();

      const commentId = `rls-moderation-${Date.now()}`;
      await client.query(
        `INSERT INTO "MilestoneComment"
          (id, body, visibility, "milestoneId", "authorId", "updatedAt")
         VALUES ($1, '<p>original</p>', 'CUSTOMER_VISIBLE', $2, $3, NOW())`,
        [commentId, row!.milestone_id, row!.author_id],
      );

      await client.query("SET LOCAL ROLE service_platform_app");
      await client.query(`SELECT set_config('app.user_id', 'review-admin', true)`);
      await client.query(`SELECT set_config('app.is_platform_admin', 'true', true)`);
      await client.query(`SELECT set_config('app.is_staff', 'true', true)`);

      const ordinaryAdminUpdate = await client.query(
        `UPDATE "MilestoneComment" SET body = '<p>blocked</p>' WHERE id = $1`,
        [commentId],
      );
      expect(ordinaryAdminUpdate.rowCount).toBe(0);

      await client.query(
        `SELECT set_config('app.content_risk_snapshot_write', 'true', true)`,
      );
      const moderationUpdate = await client.query(
        `UPDATE "MilestoneComment" SET body = '<p>restored</p>' WHERE id = $1`,
        [commentId],
      );
      expect(moderationUpdate.rowCount).toBe(1);
    } finally {
      await client.query("ROLLBACK");
    }
  });
});
