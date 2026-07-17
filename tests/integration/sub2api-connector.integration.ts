import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";
import { SUB2API_CONNECTOR_PLUGIN_KEY } from "@/modules/plugins/plugin-registry";
import { ensurePluginInstallations } from "@/modules/plugins/plugin-installation-service";
import type { Actor } from "@/lib/actor";
import { addRequestMessage } from "@/modules/requests/request-command-service";

const owner = new Pool({
  connectionString: process.env.DATABASE_MIGRATION_URL,
  max: 1,
});
const app = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });

const ids = {
  project: randomUUID(),
  binding: randomUUID(),
  publicId: randomUUID(),
  contactA: randomUUID(),
  contactB: randomUUID(),
  requestA: randomUUID(),
  requestB: randomUUID(),
  messageA: randomUUID(),
  messageB: randomUUID(),
  update: randomUUID(),
};

let previousPlugin: { enabled: boolean; healthStatus: string };
let adminActor: Actor;

beforeAll(async () => {
  await ensurePluginInstallations();
  const plugin = await owner.query<{ enabled: boolean; healthStatus: string }>(
    `SELECT enabled, "healthStatus" FROM "PluginInstallation" WHERE key = $1`,
    [SUB2API_CONNECTOR_PLUGIN_KEY],
  );
  previousPlugin = plugin.rows[0];
  await owner.query(
    `UPDATE "PluginInstallation" SET enabled = true, "healthStatus" = 'READY', "updatedAt" = NOW() WHERE key = $1`,
    [SUB2API_CONNECTOR_PLUGIN_KEY],
  );
  const base = await owner.query<{
    customerSpaceId: string;
    serviceTypeId: string;
    createdById: string;
    categoryId: string;
    creatorName: string;
    creatorEmail: string;
    creatorRole: "PLATFORM_ADMIN" | "PROJECT_MANAGER" | "TECHNICIAN" | "CUSTOMER";
  }>(
    `
      SELECT
        project."customerSpaceId",
        project."serviceTypeId",
        project."createdById",
        category.id AS "categoryId"
        , creator.name AS "creatorName"
        , creator.email AS "creatorEmail"
        , creator."platformRole" AS "creatorRole"
      FROM "Project" project
      JOIN "RequestCategory" category
        ON category."serviceTypeId" = project."serviceTypeId"
      JOIN "User" creator ON creator.id = project."createdById"
      WHERE category.active = true
      LIMIT 1
    `,
  );
  const row = base.rows[0];
  if (!row) throw new Error("请先执行 pnpm db:seed");
  adminActor = {
    id: row.createdById,
    name: row.creatorName,
    email: row.creatorEmail,
    platformRole: "PLATFORM_ADMIN",
    isPlatformAdmin: true,
    isStaff: true,
  };

  await owner.query(
    `INSERT INTO "Project" (id, title, status, kind, "customerSpaceId", "serviceTypeId", "createdById", "updatedAt") VALUES ($1, 'Sub2API RLS 集成测试', 'ACTIVE', 'EXTERNAL_INTEGRATION', $2, $3, $4, NOW())`,
    [ids.project, row.customerSpaceId, row.serviceTypeId, row.createdById],
  );
  await owner.query(
    `INSERT INTO "ProjectPluginBinding" (id, "projectId", "pluginKey", "publicId", status, "updatedAt") VALUES ($1, $2, $3, $4, 'ACTIVE', NOW())`,
    [ids.binding, ids.project, SUB2API_CONNECTOR_PLUGIN_KEY, ids.publicId],
  );
  await owner.query(
    `INSERT INTO "Sub2ApiConnection" ("bindingId", "baseUrl", "sourceOrigin", "healthStatus", "updatedAt") VALUES ($1, 'https://sub.example.test', 'https://sub.example.test', 'READY', NOW())`,
    [ids.binding],
  );
  await owner.query(
    `INSERT INTO "ExternalContact" (id, "bindingId", "externalUserId", "displayName", "updatedAt") VALUES ($1, $3, 'external-a', '外部用户 A', NOW()), ($2, $3, 'external-b', '外部用户 B', NOW())`,
    [ids.contactA, ids.contactB, ids.binding],
  );
  await owner.query(
    `INSERT INTO "ServiceRequest" (id, number, title, description, priority, status, "projectId", "categoryId", "createdByExternalContactId", "updatedAt") VALUES ($1, $2, 'A 的工单', 'A', 'NORMAL', 'PENDING', $5, $6, $3, NOW()), ($4, $7, 'B 的工单', 'B', 'NORMAL', 'PENDING', $5, $6, $8, NOW())`,
    [
      ids.requestA,
      `EXT-A-${ids.requestA}`,
      ids.contactA,
      ids.requestB,
      ids.project,
      row.categoryId,
      `EXT-B-${ids.requestB}`,
      ids.contactB,
    ],
  );
  await owner.query(
    `INSERT INTO "RequestMessage" (id, body, "serviceRequestId", "externalAuthorId", "updatedAt") VALUES ($1, 'A 的消息', $2, $3, NOW()), ($4, 'B 的消息', $5, $6, NOW())`,
    [ids.messageA, ids.requestA, ids.contactA, ids.messageB, ids.requestB, ids.contactB],
  );
  await owner.query(
    `INSERT INTO "ProjectUpdate" (id, title, body, "projectId", "authorId", "updatedAt") VALUES ($1, '内部项目动态', '不应向外部联系人开放', $2, $3, NOW())`,
    [ids.update, ids.project, row.createdById],
  );
});

afterAll(async () => {
  await owner.query(`DELETE FROM "Project" WHERE id = $1`, [ids.project]);
  await owner.query(
    `UPDATE "PluginInstallation" SET enabled = $2, "healthStatus" = $3, "updatedAt" = NOW() WHERE key = $1`,
    [
      SUB2API_CONNECTOR_PLUGIN_KEY,
      previousPlugin.enabled,
      previousPlugin.healthStatus,
    ],
  );
  await app.end();
  await owner.end();
});

describe("Sub2API 外部联系人 RLS", () => {
  it("只能读取自己的工单和消息，不能读取项目动态", async () => {
    const result = await queryAsExternal<{
      ownRequests: string;
      otherRequests: string;
      ownMessages: string;
      otherMessages: string;
      projectUpdates: string;
    }>(ids.contactA, `
      SELECT
        (SELECT COUNT(*) FROM "ServiceRequest" WHERE id = '${ids.requestA}')::text AS "ownRequests",
        (SELECT COUNT(*) FROM "ServiceRequest" WHERE id = '${ids.requestB}')::text AS "otherRequests",
        (SELECT COUNT(*) FROM "RequestMessage" WHERE id = '${ids.messageA}')::text AS "ownMessages",
        (SELECT COUNT(*) FROM "RequestMessage" WHERE id = '${ids.messageB}')::text AS "otherMessages",
        (SELECT COUNT(*) FROM "ProjectUpdate" WHERE id = '${ids.update}')::text AS "projectUpdates"
    `);
    expect(result).toEqual([{
      ownRequests: "1",
      otherRequests: "0",
      ownMessages: "1",
      otherMessages: "0",
      projectUpdates: "0",
    }]);
  });

  it("数据库约束拒绝同时填写正式作者和外部联系人", async () => {
    await expect(
      owner.query(
        `UPDATE "ServiceRequest" SET "createdById" = (SELECT "createdById" FROM "Project" WHERE id = $2) WHERE id = $1`,
        [ids.requestA, ids.project],
      ),
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("主站回复会向外部联系人的本人工单 SSE 发布事件", async () => {
    const result = await addRequestMessage(adminActor, ids.requestA, {
      body: "<p>后台公开回复</p>",
      visibility: "CUSTOMER_VISIBLE",
    });
    const events = await queryAsExternal<{ count: string }>(
      ids.contactA,
      `SELECT COUNT(*)::text AS count FROM "EventRecord" WHERE "serviceRequestId" = '${ids.requestA}' AND type = 'REQUEST_MESSAGE_CREATED' AND payload->>'messageId' = '${result.message.id}'`,
    );
    expect(events).toEqual([{ count: "1" }]);
  });
});

async function queryAsExternal<T extends Record<string, unknown>>(
  externalContactId: string,
  sql: string,
) {
  const client = await app.connect();
  try {
    await setExternalContext(client, externalContactId);
    const result = await client.query<T>(sql);
    await client.query("COMMIT");
    return result.rows;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function setExternalContext(client: PoolClient, externalContactId: string) {
  await client.query("BEGIN");
  await client.query(`SELECT set_config('app.user_id', '', true)`);
  await client.query(`SELECT set_config('app.is_platform_admin', 'false', true)`);
  await client.query(`SELECT set_config('app.is_staff', 'false', true)`);
  await client.query(
    `SELECT set_config('app.external_contact_id', $1, true)`,
    [externalContactId],
  );
}
