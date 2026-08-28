import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";
import { SUB2API_CONNECTOR_PLUGIN_KEY } from "@/modules/plugins/plugin-registry";
import { ensurePluginInstallations } from "@/modules/plugins/plugin-installation-service";
import type { Actor } from "@/lib/actor";
import { addRequestMessage } from "@/modules/requests/request-command-service";
import {
  createProject,
  deleteProject,
} from "@/modules/projects/project-service";
import { listCustomerSpaces } from "@/modules/customer-spaces/customer-space-service";
import {
  confirmExternalRequestClosed,
  createExternalRequest,
} from "@/modules/integrations/external/request-service";
import { updateExternalPresence } from "@/modules/integrations/external/presence-service";
import { updateRequestPresence } from "@/modules/requests/request-presence-service";

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
let serviceTypeId = "";
let categoryId = "";
let externalCustomerSpaceId = "";
let managedProjectId = "";
let managedCustomerSpaceId = "";

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
  if (!row) throw new Error("请先执行 pnpm test:integration:prepare");
  adminActor = {
    id: row.createdById,
    name: row.creatorName,
    email: row.creatorEmail,
    platformRole: "PLATFORM_ADMIN",
    isPlatformAdmin: true,
    isStaff: true,
  };
  serviceTypeId = row.serviceTypeId;
  categoryId = row.categoryId;
  externalCustomerSpaceId = row.customerSpaceId;

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
  if (managedProjectId) {
    await owner.query(`DELETE FROM "Project" WHERE id = $1`, [managedProjectId]);
  }
  if (managedCustomerSpaceId) {
    await owner.query(`DELETE FROM "CustomerSpace" WHERE id = $1`, [managedCustomerSpaceId]);
  }
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
  it("创建工单时使用系统受众视角发送通知", async () => {
    const created = await createExternalRequest(
      {
        id: ids.contactA,
        bindingId: ids.binding,
        externalUserId: "external-a",
        name: "外部用户 A",
        email: null,
        username: null,
        projectId: ids.project,
        customerSpaceId: externalCustomerSpaceId,
      },
      {
        title: "外部创建通知回归",
        description: "<p>验证外部身份不会被客户空间 RLS 阻断。</p>",
        categoryId,
        priority: "NORMAL",
      },
      { customerMemberNotificationsEnabled: false },
    );

    try {
      const events = await owner.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM "EventRecord" WHERE "serviceRequestId" = $1 AND type = 'REQUEST_CREATED'`,
        [created.id],
      );
      expect(events.rows[0]?.count).not.toBe("0");
    } finally {
      await owner.query(`DELETE FROM "ServiceRequest" WHERE id = $1`, [created.id]);
    }
  });

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

  it("后台心跳能识别 Sub2API 外部客户在线", async () => {
    const externalSessionId = randomUUID();
    const staffSessionId = randomUUID();
    const externalActor = {
      id: ids.contactA,
      bindingId: ids.binding,
      externalUserId: "external-a",
      name: "外部用户 A",
      email: null,
      username: null,
      projectId: ids.project,
      customerSpaceId: externalCustomerSpaceId,
    };

    await expect(
      updateExternalPresence(externalActor, ids.requestA, {
        action: "heartbeat",
        sessionId: externalSessionId,
      }),
      // 外部门户只回是否在线：它自绘一个简单指示点，不用端图标，
      // 故不返回 counterpartClients（站内 presence 才有）
    ).resolves.toEqual({ counterpartOnline: false });
    await expect(
      updateRequestPresence(adminActor, ids.requestA, {
        action: "heartbeat",
        sessionId: staffSessionId,
      }),
    ).resolves.toEqual({
      counterpartOnline: true,
      counterpartClients: ["WEB"],
    });

    await updateRequestPresence(adminActor, ids.requestA, {
      action: "leave",
      sessionId: staffSessionId,
    });
    await updateExternalPresence(externalActor, ids.requestA, {
      action: "leave",
      sessionId: externalSessionId,
    });
  });

  it("外部联系人不能关闭已归档工单", async () => {
    const previous = await owner.query<{
      status: string;
      archivedAt: Date | null;
      resolvedAt: Date | null;
      closedAt: Date | null;
    }>(
      `SELECT status, "archivedAt", "resolvedAt", "closedAt" FROM "ServiceRequest" WHERE id = $1`,
      [ids.requestA],
    );
    const original = previous.rows[0]!;
    await owner.query(
      `UPDATE "ServiceRequest" SET status = 'RESOLVED', "archivedAt" = NOW(), "resolvedAt" = NOW(), "closedAt" = NULL, "updatedAt" = NOW() WHERE id = $1`,
      [ids.requestA],
    );
    const externalActor = {
      id: ids.contactA,
      bindingId: ids.binding,
      externalUserId: "external-a",
      name: "外部用户 A",
      email: null,
      username: null,
      projectId: ids.project,
      customerSpaceId: externalCustomerSpaceId,
    };

    try {
      await expect(
        confirmExternalRequestClosed(externalActor, ids.requestA),
      ).rejects.toMatchObject({ code: "REQUEST_ARCHIVED", status: 409 });
    } finally {
      await owner.query(
        `UPDATE "ServiceRequest" SET status = $2, "archivedAt" = $3, "resolvedAt" = $4, "closedAt" = $5, "updatedAt" = NOW() WHERE id = $1`,
        [
          ids.requestA,
          original.status,
          original.archivedAt,
          original.resolvedAt,
          original.closedAt,
        ],
      );
    }
  });

  it("外部联系人要出现在发送预览里", async () => {
    const { previewRequestDelivery } = await import(
      "@/modules/requests/request-command-service"
    );
    // 必须列出他：不列的话弹窗会说「0 人 / 本次没有需要提醒的人」，
    // 提交后却照样给客户发了信，员工也没机会把他排除掉
    await owner.query(
      `UPDATE "Sub2ApiConnection"
       SET "emailNotificationsEnabled" = true, "updatedAt" = NOW()
       WHERE "bindingId" = $1`,
      [ids.binding],
    );
    // 夹具建联系人时没留邮箱，补上才够得着邮件通知的条件
    await owner.query(
      `UPDATE "ExternalContact" SET email = $2, "updatedAt" = NOW() WHERE id = $1`,
      [ids.contactA, "external-a@example.test"],
    );
    const preview = await previewRequestDelivery(
      adminActor,
      ids.requestA,
      "PUBLIC_MESSAGE",
    );
    expect(
      preview.externalEmailContacts.map((item) => item.id),
    ).toContain(ids.contactA);

    // 关掉外部邮件通知后就不该再出现
    await owner.query(
      `UPDATE "Sub2ApiConnection"
       SET "emailNotificationsEnabled" = false, "updatedAt" = NOW()
       WHERE "bindingId" = $1`,
      [ids.binding],
    );
    const quiet = await previewRequestDelivery(
      adminActor,
      ids.requestA,
      "PUBLIC_MESSAGE",
    );
    expect(quiet.externalEmailContacts).toEqual([]);
  });

  it("在预览里取消勾选外部联系人，就真的不给他发信", async () => {
    await owner.query(
      `UPDATE "Sub2ApiConnection"
       SET "emailNotificationsEnabled" = true, "updatedAt" = NOW()
       WHERE "bindingId" = $1`,
      [ids.binding],
    );
    await owner.query(
      `UPDATE "ExternalContact" SET email = $2, "updatedAt" = NOW() WHERE id = $1`,
      [ids.contactA, "external-a@example.test"],
    );
    const mailCount = async () => {
      const result = await owner.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM "MailMessage" WHERE "toEmail" = $1`,
        ["external-a@example.test"],
      );
      return Number(result.rows[0]?.count ?? "0");
    };
    const before = await mailCount();

    // 排除名单里带上他：外部联系人邮件不挂在 Notification 行上，
    // 若拿「与通知行相交后的排除名单」去判，他的 id 早被丢掉，排除等于没生效
    await addRequestMessage(
      adminActor,
      ids.requestA,
      { body: "<p>排除外部联系人</p>", visibility: "CUSTOMER_VISIBLE" },
      { excludeUserIds: [ids.contactA] },
    );
    expect(await mailCount()).toBe(before);

    // 不排除时照常发
    await addRequestMessage(adminActor, ids.requestA, {
      body: "<p>正常通知外部联系人</p>",
      visibility: "CUSTOMER_VISIBLE",
    });
    expect(await mailCount()).toBe(before + 1);

    await owner.query(
      `UPDATE "Sub2ApiConnection"
       SET "emailNotificationsEnabled" = false, "updatedAt" = NOW()
       WHERE "bindingId" = $1`,
      [ids.binding],
    );
  });

  it("状态变更的预览要跟着目标状态走：没有模板的状态不该说会发信", async () => {
    const { previewRequestDelivery } = await import(
      "@/modules/requests/request-command-service"
    );
    await owner.query(
      `UPDATE "Sub2ApiConnection"
       SET "emailNotificationsEnabled" = true, "updatedAt" = NOW()
       WHERE "bindingId" = $1`,
      [ids.binding],
    );
    await owner.query(
      `UPDATE "ExternalContact" SET email = $2, "updatedAt" = NOW() WHERE id = $1`,
      [ids.contactA, "external-a@example.test"],
    );

    // 有模板：WAITING_CUSTOMER / RESOLVED / CLOSED
    const waiting = await previewRequestDelivery(
      adminActor,
      ids.requestA,
      "STATUS",
      "WAITING_CUSTOMER",
    );
    expect(waiting.externalEmailContacts.map((item) => item.id)).toContain(
      ids.contactA,
    );

    // 没有模板：statusMail 会返回 null，预览就不能说他会收到
    const inProgress = await previewRequestDelivery(
      adminActor,
      ids.requestA,
      "STATUS",
      "IN_PROGRESS",
    );
    expect(inProgress.externalEmailContacts).toEqual([]);

    await owner.query(
      `UPDATE "Sub2ApiConnection"
       SET "emailNotificationsEnabled" = false, "updatedAt" = NOW()
       WHERE "bindingId" = $1`,
      [ids.binding],
    );
  });

});

describe("Sub2API 外部项目空间隔离", () => {
  it("创建时自动生成托管空间且不进入客户列表，删除项目时同步清理", async () => {
    const project = await createProject(adminActor, {
      title: "自动托管空间测试",
      kind: "EXTERNAL_INTEGRATION",
      connectorPluginKey: SUB2API_CONNECTOR_PLUGIN_KEY,
      serviceTypeId,
    });
    managedProjectId = project.id;
    managedCustomerSpaceId = project.customerSpaceId;

    const space = await owner.query<{
      kind: string;
      memberLimit: number;
      membershipCount: string;
    }>(
      `SELECT space.kind, space."memberLimit", COUNT(membership.id)::text AS "membershipCount"
       FROM "CustomerSpace" space
       LEFT JOIN "Membership" membership ON membership."customerSpaceId" = space.id
       WHERE space.id = $1
       GROUP BY space.id`,
      [managedCustomerSpaceId],
    );
    expect(space.rows[0]).toEqual({
      kind: "EXTERNAL_MANAGED",
      memberLimit: 0,
      membershipCount: "0",
    });

    const customerSpaces = await listCustomerSpaces(adminActor);
    expect(customerSpaces.some((item) => item.id === managedCustomerSpaceId)).toBe(false);

    await deleteProject(adminActor, managedProjectId);
    managedProjectId = "";
    const remaining = await owner.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM "CustomerSpace" WHERE id = $1`,
      [managedCustomerSpaceId],
    );
    expect(remaining.rows[0]?.count).toBe("0");
    managedCustomerSpaceId = "";
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
