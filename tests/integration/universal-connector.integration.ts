import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { POST as exchangeTicketRoute } from "@/app/api/v1/embed/universal/exchange/route";
import { POST as createLaunchTicketRoute } from "@/app/api/v1/integrations/universal/launch-tickets/route";
import type { Actor } from "@/lib/actor";
import { withActorDb } from "@/lib/actor";
import { listExternalContacts } from "@/modules/integrations/external/contact-service";
import { createExternalRequest, getExternalRequest, listExternalRequests } from "@/modules/integrations/external/request-service";
import {
  createUniversalCredentialForProject,
  getUniversalIntegration,
  revokeUniversalCredential,
  saveUniversalIntegration,
} from "@/modules/integrations/universal/connection-service";
import {
  createUniversalLaunchTicket,
  exchangeUniversalTicket,
} from "@/modules/integrations/universal/ticket-service";
import {
  createUniversalCredential,
  createUniversalTicket,
} from "@/modules/integrations/universal/security";
import { UNIVERSAL_PLUGIN_KEY } from "@/modules/integrations/universal/constants";
import { retryUniversalWebhookDelivery } from "@/modules/integrations/universal/webhook-admin-service";
import {
  listDueUniversalWebhookDeliveries,
  processUniversalWebhookDelivery,
} from "@/modules/integrations/universal/webhook-service";
import { ensurePluginInstallations } from "@/modules/plugins/plugin-installation-service";
import { addRequestMessage } from "@/modules/requests/request-command-service";

const owner = new Pool({
  connectionString: process.env.DATABASE_MIGRATION_URL,
  max: 1,
});

const ids = {
  project: randomUUID(),
  binding: randomUUID(),
  publicId: randomUUID(),
};

let previousPlugin: { enabled: boolean; healthStatus: string };
let adminActor: Actor;
let managerActor: Actor;
let customerSpaceId = "";
let serviceTypeId = "";
let categoryId = "";
let clientId = "";
let clientSecret = "";
let externalActor: {
  id: string;
  bindingId: string;
  externalUserId: string;
  name: string;
  email: string | null;
  username: string | null;
  sourceKey: string;
  sourceLabel: string;
  projectId: string;
  customerSpaceId: string;
};

beforeAll(async () => {
  await ensurePluginInstallations();
  const previous = await owner.query<{
    enabled: boolean;
    healthStatus: string;
  }>(
    `SELECT enabled, "healthStatus" FROM "PluginInstallation" WHERE key = $1`,
    [UNIVERSAL_PLUGIN_KEY],
  );
  previousPlugin = previous.rows[0];
  await owner.query(
    `UPDATE "PluginInstallation" SET enabled = true, "healthStatus" = 'READY', "updatedAt" = NOW() WHERE key = $1`,
    [UNIVERSAL_PLUGIN_KEY],
  );
  const base = await owner.query<{
    customerSpaceId: string;
    serviceTypeId: string;
    categoryId: string;
    createdById: string;
    creatorName: string;
    creatorEmail: string;
  }>(`
    SELECT
      project."customerSpaceId",
      project."serviceTypeId",
      category.id AS "categoryId",
      project."createdById",
      creator.name AS "creatorName",
      creator.email AS "creatorEmail"
    FROM "Project" project
    JOIN "RequestCategory" category
      ON category."serviceTypeId" = project."serviceTypeId"
      AND category.active = true
    JOIN "User" creator ON creator.id = project."createdById"
    LIMIT 1
  `);
  const row = base.rows[0];
  if (!row) throw new Error("请先执行 pnpm test:integration:prepare");
  customerSpaceId = row.customerSpaceId;
  serviceTypeId = row.serviceTypeId;
  categoryId = row.categoryId;
  adminActor = {
    id: row.createdById,
    name: row.creatorName,
    email: row.creatorEmail,
    platformRole: "PLATFORM_ADMIN",
    isPlatformAdmin: true,
    isStaff: true,
  };
  managerActor = {
    ...adminActor,
    platformRole: "PROJECT_MANAGER",
    isPlatformAdmin: false,
  };
  await owner.query(
    `INSERT INTO "Project" (id, title, status, kind, "customerSpaceId", "serviceTypeId", "createdById", "updatedAt") VALUES ($1, 'Achord Connect 集成测试', 'ACTIVE', 'EXTERNAL_INTEGRATION', $2, $3, $4, NOW())`,
    [ids.project, customerSpaceId, serviceTypeId, adminActor.id],
  );
  await owner.query(
    `INSERT INTO "ProjectPluginBinding" (id, "projectId", "pluginKey", "externalConnectorSlot", "publicId", status, "updatedAt") VALUES ($1, $2, $3, 'PRIMARY', $4, 'ACTIVE', NOW())`,
    [ids.binding, ids.project, UNIVERSAL_PLUGIN_KEY, ids.publicId],
  );
  await owner.query(
    `INSERT INTO "ProjectStaff" (id, "projectId", "userId", role) VALUES ($1, $2, $3, 'PROJECT_MANAGER')`,
    [randomUUID(), ids.project, adminActor.id],
  );
  await owner.query(
    `INSERT INTO "UniversalConnectorConnection" ("bindingId", name, "allowedOrigins", "profileFields", "webhookUrl", "webhookSecretEncrypted", "webhookEvents", "webhookStatus", "healthStatus", "updatedAt") VALUES ($1, '测试连接', '["https://app.example.test"]'::jsonb, '[{"key":"level","label":"等级","type":"number"}]'::jsonb, 'https://webhook.example.test/achord', 'encrypted-test-value', '["request.created","request.public_message.created","request.status.changed","request.unread.changed"]'::jsonb, 'UNVERIFIED', 'READY', NOW())`,
    [ids.binding],
  );
  const credential = createUniversalCredential();
  clientId = credential.clientId;
  clientSecret = credential.clientSecret;
  await owner.query(
    `INSERT INTO "UniversalConnectorCredential" (id, "bindingId", "clientId", "secretHash", "secretPrefix") VALUES ($1, $2, $3, $4, $5)`,
    [
      randomUUID(),
      ids.binding,
      credential.clientId,
      credential.secretHash,
      credential.secretPrefix,
    ],
  );
});

afterAll(async () => {
  await owner.query(
    `UPDATE "AuditLog" SET "externalActorId" = NULL WHERE "projectId" = $1`,
    [ids.project],
  );
  await owner.query(`DELETE FROM "Project" WHERE id = $1`, [ids.project]);
  await owner.query(
    `UPDATE "PluginInstallation" SET enabled = $2, "healthStatus" = $3, "updatedAt" = NOW() WHERE key = $1`,
    [UNIVERSAL_PLUGIN_KEY, previousPlugin.enabled, previousPlugin.healthStatus],
  );
  await owner.end();
});

describe("Achord Connect 集成", () => {
  it("创建 60 秒票据、单次兑换并同步受控资料", async () => {
    const launch = await issueTicket("external-a", {
      name: "外部用户 A",
      email: "A@EXAMPLE.COM",
      avatarUrl: "https://cdn.example.test/avatar-a.png",
      attributes: { level: 3 },
    });
    const ticket = new URL(launch.launchUrl).hash.slice("#ticket=".length);
    await expect(
      exchangeUniversalTicket(
        request("https://support.example.test/api/v1/embed/universal/exchange"),
        {
          publicId: ids.publicId,
          ticket: decodeURIComponent(ticket),
          parentOrigin: "https://other.example.test",
        },
      ),
    ).rejects.toMatchObject({
      code: "UNIVERSAL_PARENT_ORIGIN_INVALID",
      status: 403,
    });
    const exchanged = await exchangeUniversalTicket(
      request("https://support.example.test/api/v1/embed/universal/exchange"),
      {
        publicId: ids.publicId,
        ticket: decodeURIComponent(ticket),
        parentOrigin: "https://app.example.test",
      },
    );
    expect(exchanged.contact).toMatchObject({
      externalUserId: "external-a",
      email: "a@example.com",
      avatarUrl: "https://cdn.example.test/avatar-a.png",
      attributes: { level: 3 },
    });
    expect(exchanged.parentOrigins).toEqual(["https://app.example.test"]);
    const contactOrigin = await owner.query<{ lastParentOrigin: string | null }>(
      `SELECT "lastParentOrigin" FROM "ExternalContact" WHERE id = $1`,
      [exchanged.contact.id],
    );
    expect(contactOrigin.rows[0]?.lastParentOrigin).toBe(
      "https://app.example.test",
    );
    externalActor = {
      id: exchanged.contact.id,
      bindingId: ids.binding,
      externalUserId: exchanged.contact.externalUserId,
      name: exchanged.contact.name,
      email: exchanged.contact.email,
      username: exchanged.contact.username,
      sourceKey: UNIVERSAL_PLUGIN_KEY,
      sourceLabel: "通用工单连接器",
      projectId: ids.project,
      customerSpaceId,
    };
    await expect(
      exchangeUniversalTicket(
        request("https://support.example.test/api/v1/embed/universal/exchange"),
        {
          publicId: ids.publicId,
          ticket: decodeURIComponent(ticket),
          parentOrigin: "https://app.example.test",
        },
      ),
    ).rejects.toMatchObject({ code: "UNIVERSAL_TICKET_INVALID", status: 401 });
  });

  it("在读取签票正文前鉴权，并对公共 JSON 请求执行 64KB 硬限制", async () => {
    const oversizedBody = JSON.stringify({ value: "x".repeat(70 * 1024) });
    const unauthorized = await createLaunchTicketRoute(
      new Request(
        "https://support.example.test/api/v1/integrations/universal/launch-tickets",
        { method: "POST", body: oversizedBody },
      ),
    );
    expect(unauthorized.status).toBe(401);

    const authorized = await createLaunchTicketRoute(
      new Request(
        "https://support.example.test/api/v1/integrations/universal/launch-tickets",
        {
          method: "POST",
          headers: {
            Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
          },
          body: oversizedBody,
        },
      ),
    );
    expect(authorized.status).toBe(413);
    await expect(authorized.json()).resolves.toMatchObject({
      error: { code: "REQUEST_BODY_TOO_LARGE" },
    });

    const exchange = await exchangeTicketRoute(
      new Request(
        "https://support.example.test/api/v1/embed/universal/exchange",
        { method: "POST", body: oversizedBody },
      ),
    );
    expect(exchange.status).toBe(413);
  });

  it("多 Origin 连接要求后端指定可信返回 Origin", async () => {
    await owner.query(
      `UPDATE "UniversalConnectorConnection" SET "allowedOrigins" = $2::jsonb, "updatedAt" = NOW() WHERE "bindingId" = $1`,
      [
        ids.binding,
        JSON.stringify([
          "https://app.example.test",
          "https://secondary.example.test",
        ]),
      ],
    );
    try {
      await expect(
        issueTicket(`missing-origin-${randomUUID()}`, { name: "缺少来源" }),
      ).rejects.toMatchObject({
        code: "UNIVERSAL_RETURN_ORIGIN_REQUIRED",
        status: 422,
      });
      const launch = await issueTicket(
        `origin-${randomUUID()}`,
        { name: "多来源用户" },
        undefined,
        { returnOrigin: "https://secondary.example.test" },
      );
      const ticket = decodeURIComponent(
        new URL(launch.launchUrl).hash.slice("#ticket=".length),
      );
      const missingOriginResponse = await exchangeTicketRoute(
        new Request(
          "https://support.example.test/api/v1/embed/universal/exchange",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ publicId: ids.publicId, ticket }),
          },
        ),
      );
      expect(missingOriginResponse.status).toBe(422);
      await expect(
        exchangeUniversalTicket(
          request("https://support.example.test/api/v1/embed/universal/exchange"),
          {
            publicId: ids.publicId,
            ticket,
            parentOrigin: "",
          },
        ),
      ).rejects.toMatchObject({
        code: "UNIVERSAL_PARENT_ORIGIN_REQUIRED",
        status: 403,
      });
      await expect(
        exchangeUniversalTicket(
          request("https://support.example.test/api/v1/embed/universal/exchange"),
          {
            publicId: ids.publicId,
            ticket,
            parentOrigin: "https://app.example.test",
          },
        ),
      ).rejects.toMatchObject({
        code: "UNIVERSAL_PARENT_ORIGIN_MISMATCH",
        status: 403,
      });
      const exchanged = await exchangeUniversalTicket(
        request("https://support.example.test/api/v1/embed/universal/exchange"),
        {
          publicId: ids.publicId,
          ticket,
          parentOrigin: "https://secondary.example.test",
        },
      );
      const contactOrigin = await owner.query<{ lastParentOrigin: string | null }>(
        `SELECT "lastParentOrigin" FROM "ExternalContact" WHERE id = $1`,
        [exchanged.contact.id],
      );
      expect(contactOrigin.rows[0]?.lastParentOrigin).toBe(
        "https://secondary.example.test",
      );
    } finally {
      await owner.query(
        `UPDATE "UniversalConnectorConnection" SET "allowedOrigins" = '["https://app.example.test"]'::jsonb, "updatedAt" = NOW() WHERE "bindingId" = $1`,
        [ids.binding],
      );
    }
  });

  it("项目负责人只能看到凭据数量，双凭据轮换不中断连接", async () => {
    const contacts = await listExternalContacts(managerActor, ids.project, {
      keyword: "external-a",
      limit: 50,
    });
    expect(contacts.items).toEqual([
      expect.objectContaining({
        externalUserId: "external-a",
        sourceKey: UNIVERSAL_PLUGIN_KEY,
        sourceLabel: "通用服务请求连接器",
        avatarUrl: "https://cdn.example.test/avatar-a.png",
        profileAttributes: { level: 3 },
      }),
    ]);
    const managerView = await getUniversalIntegration(managerActor, ids.project);
    expect(managerView.connection).toMatchObject({ activeCredentialCount: 1 });
    expect(managerView.connection?.credentials).toEqual([]);
    const hiddenCredentials = await withActorDb(managerActor, (tx) =>
      tx.universalConnectorCredential.findMany({
        where: { bindingId: ids.binding },
      }),
    );
    expect(hiddenCredentials).toEqual([]);
    await expect(
      withActorDb(managerActor, (tx) =>
        tx.universalConnectorConnection.update({
          where: { bindingId: ids.binding },
          data: { name: "不应允许的修改" },
        }),
      ),
    ).rejects.toThrow();

    const rotated = await createUniversalCredentialForProject(
      adminActor,
      ids.project,
    );
    const health = await owner.query<{ healthStatus: string }>(
      `SELECT "healthStatus" FROM "UniversalConnectorConnection" WHERE "bindingId" = $1`,
      [ids.binding],
    );
    expect(health.rows[0]?.healthStatus).toBe("READY");
    const launch = await issueTicket(
      `rotated-${randomUUID()}`,
      { name: "轮换验证用户" },
      { clientId: rotated.clientId, clientSecret: rotated.clientSecret },
    );
    expect(launch.launchUrl).toContain(`#ticket=`);

    const previous = await owner.query<{ id: string }>(
      `SELECT id FROM "UniversalConnectorCredential" WHERE "bindingId" = $1 AND "clientId" = $2`,
      [ids.binding, clientId],
    );
    await revokeUniversalCredential(
      adminActor,
      ids.project,
      previous.rows[0].id,
    );
    clientId = rotated.clientId;
    clientSecret = rotated.clientSecret;
  });

  it("重新调度中断的 Webhook，并终止已耗尽的卡死投递", async () => {
    const recoverableId = randomUUID();
    const exhaustedId = randomUUID();
    const terminalId = randomUUID();
    const deliveredId = randomUUID();
    const staleAt = new Date(Date.now() - 20 * 60_000);
    await owner.query(
      `INSERT INTO "UniversalWebhookDelivery" (id, "bindingId", "eventId", "eventType", payload, status, "attemptCount", "lastAttemptAt", "updatedAt") VALUES ($1, $2, $3, 'connector.test', '{}'::jsonb, 'PROCESSING', 1, $6, NOW()), ($4, $2, $5, 'connector.test', '{}'::jsonb, 'PROCESSING', 6, $6, NOW())`,
      [
        recoverableId,
        ids.binding,
        randomUUID(),
        exhaustedId,
        randomUUID(),
        staleAt,
      ],
    );
    await owner.query(
      `INSERT INTO "UniversalWebhookDelivery" (id, "bindingId", "eventId", "eventType", payload, status, "attemptCount", "nextAttemptAt", "lastError", "updatedAt") VALUES ($1, $2, $3, 'connector.test', '{}'::jsonb, 'FAILED', 1, NULL, '永久失败', NOW())`,
      [terminalId, ids.binding, randomUUID()],
    );
    await owner.query(
      `INSERT INTO "UniversalWebhookDelivery" (id, "bindingId", "eventId", "eventType", payload, status, "attemptCount", "deliveredAt", "updatedAt") VALUES ($1, $2, $3, 'connector.test', '{}'::jsonb, 'DELIVERED', 1, NOW(), NOW())`,
      [deliveredId, ids.binding, randomUUID()],
    );
    await expect(
      retryUniversalWebhookDelivery(adminActor, ids.project, deliveredId),
    ).rejects.toMatchObject({
      code: "UNIVERSAL_WEBHOOK_NOT_RETRYABLE",
      status: 409,
    });
    const staleBefore = new Date(Date.now() - 10 * 60_000);
    const databaseRows = await owner.query<{
      id: string;
      status: string;
      attemptCount: number;
      stale: boolean;
    }>(
      `SELECT id, status, "attemptCount", "lastAttemptAt" <= $2 AS stale FROM "UniversalWebhookDelivery" WHERE id = ANY($1::text[]) ORDER BY id`,
      [[recoverableId, exhaustedId], staleBefore],
    );
    expect(databaseRows.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: recoverableId,
          status: "PROCESSING",
          attemptCount: 1,
          stale: true,
        }),
      ]),
    );
    const due = await listDueUniversalWebhookDeliveries(500);
    expect(due.map((item) => item.id)).toContain(recoverableId);
    expect(due.map((item) => item.id)).not.toContain(exhaustedId);
    expect(due.map((item) => item.id)).not.toContain(terminalId);
    const processed = await processUniversalWebhookDelivery(recoverableId);
    expect(processed.queued).toBe(true);
    const recovered = await owner.query<{
      status: string;
      attemptCount: number;
      nextAttemptAt: Date | null;
    }>(
      `SELECT status, "attemptCount", "nextAttemptAt" FROM "UniversalWebhookDelivery" WHERE id = $1`,
      [recoverableId],
    );
    expect(recovered.rows[0]).toMatchObject({
      status: "FAILED",
      attemptCount: 1,
    });
    expect(recovered.rows[0].nextAttemptAt).not.toBeNull();
    const exhausted = await owner.query<{ status: string; lastError: string }>(
      `SELECT status, "lastError" FROM "UniversalWebhookDelivery" WHERE id = $1`,
      [exhaustedId],
    );
    expect(exhausted.rows[0]).toMatchObject({
      status: "FAILED",
      lastError: "Webhook 投递进程中断且已达到重试上限",
    });
  });

  it("隔离两个外部用户并写入 Webhook Outbox 与未读状态", async () => {
    const created = await createExternalRequest(
      externalActor,
      {
        title: "通用连接器工单",
        description: "<p>需要协助</p>",
        categoryId,
        priority: "NORMAL",
      },
      { customerMemberNotificationsEnabled: false },
    );
    const other = await exchangeFor("external-b", "外部用户 B");
    expect((await listExternalRequests(externalActor)).requests).toHaveLength(1);
    expect((await listExternalRequests(other)).requests).toHaveLength(0);

    await addRequestMessage(adminActor, created.id, {
      body: "<p>后台公开回复</p>",
      visibility: "CUSTOMER_VISIBLE",
    });
    const deliveryTypes = await owner.query<{ eventType: string }>(
      `SELECT "eventType" FROM "UniversalWebhookDelivery" WHERE "bindingId" = $1 ORDER BY "createdAt"`,
      [ids.binding],
    );
    expect(deliveryTypes.rows.map((item) => item.eventType)).toEqual(
      expect.arrayContaining([
        "request.created",
        "request.public_message.created",
        "request.unread.changed",
      ]),
    );
    const unread = await owner.query<{ unreadCount: number }>(
      `SELECT "unreadCount" FROM "ExternalRequestReadState" WHERE "serviceRequestId" = $1 AND "externalContactId" = $2`,
      [created.id, externalActor.id],
    );
    expect(unread.rows[0]?.unreadCount).toBe(1);
    const detail = await getExternalRequest(externalActor, created.id);
    expect(detail.messages[0]?.author.image).toBe(
      "https://cdn.example.test/avatar-a.png",
    );
    const cleared = await owner.query<{ unreadCount: number }>(
      `SELECT "unreadCount" FROM "ExternalRequestReadState" WHERE "serviceRequestId" = $1 AND "externalContactId" = $2`,
      [created.id, externalActor.id],
    );
    expect(cleared.rows[0]?.unreadCount).toBe(0);
  });

  it("数据库锁下按外部用户执行一分钟限流", async () => {
    const externalUserId = `limited-${randomUUID()}`;
    const ticketRows = Array.from({ length: 20 }, () => {
      const generated = createUniversalTicket();
      return [randomUUID(), generated.ticketHash] as const;
    });
    for (const [id, ticketHash] of ticketRows) {
      await owner.query(
        `INSERT INTO "UniversalLaunchTicket" (id, "bindingId", "ticketHash", "externalUserId", profile, context, "expiresAt") VALUES ($1, $2, $3, $4, $5::jsonb, '{}'::jsonb, NOW() + INTERVAL '60 seconds')`,
        [id, ids.binding, ticketHash, externalUserId, JSON.stringify({ id: externalUserId, name: "限流用户", email: null, username: null, avatarUrl: null, attributes: {} })],
      );
    }
    await expect(issueTicket(externalUserId, { name: "限流用户" })).rejects.toMatchObject({
      code: "UNIVERSAL_RATE_LIMITED",
      status: 429,
    });
  });

  it("联系人使用稳定游标分页并由服务端筛选", async () => {
    const marker = randomUUID();
    const seenAt = new Date();
    for (const suffix of ["a", "b", "c"]) {
      await owner.query(
        `INSERT INTO "ExternalContact" (id, "bindingId", "externalUserId", "displayName", status, "lastSeenAt", "updatedAt") VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
        [
          randomUUID(),
          ids.binding,
          `${marker}-${suffix}`,
          `分页联系人 ${suffix}`,
          suffix === "c" ? "BLOCKED" : "ACTIVE",
          seenAt,
        ],
      );
    }
    const first = await listExternalContacts(managerActor, ids.project, {
      keyword: marker,
      limit: 2,
    });
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).toEqual(expect.any(String));
    const second = await listExternalContacts(managerActor, ids.project, {
      keyword: marker,
      cursor: first.nextCursor!,
      limit: 2,
    });
    expect(second.items).toHaveLength(1);
    expect(
      new Set([...first.items, ...second.items].map((item) => item.id)).size,
    ).toBe(3);
    const blocked = await listExternalContacts(managerActor, ids.project, {
      keyword: marker,
      status: "BLOCKED",
      limit: 10,
    });
    expect(blocked.items).toHaveLength(1);
    expect(blocked.items[0]?.status).toBe("BLOCKED");
  });

  it("事务锁和数据库约束阻止一个项目绑定两个外部连接器", async () => {
    const projectId = randomUUID();
    const bindingId = randomUUID();
    await owner.query(
      `INSERT INTO "Project" (id, title, status, kind, "customerSpaceId", "serviceTypeId", "createdById", "updatedAt") VALUES ($1, '连接器冲突测试', 'ACTIVE', 'EXTERNAL_INTEGRATION', $2, $3, $4, NOW())`,
      [projectId, customerSpaceId, serviceTypeId, adminActor.id],
    );
    try {
      await owner.query(
        `INSERT INTO "ProjectPluginBinding" (id, "projectId", "pluginKey", "externalConnectorSlot", "publicId", status, "updatedAt") VALUES ($1, $2, 'sub2api-connector', 'PRIMARY', $3, 'DRAFT', NOW())`,
        [bindingId, projectId, randomUUID()],
      );
      await expect(
        saveUniversalIntegration(adminActor, projectId, {
          name: "冲突连接",
          allowedOrigins: ["https://app.example.test"],
          profileFields: [],
          emailNotificationsEnabled: true,
          customerMemberNotificationsEnabled: false,
          webhookUrl: null,
          webhookEvents: [],
        }),
      ).rejects.toMatchObject({
        code: "EXTERNAL_CONNECTOR_CONFLICT",
        status: 409,
      });
    } finally {
      await owner.query(`DELETE FROM "Project" WHERE id = $1`, [projectId]);
    }
  });

  it("并发凭据创建和撤销始终保留一到两个有效凭据", async () => {
    const created = await Promise.allSettled([
      createUniversalCredentialForProject(adminActor, ids.project),
      createUniversalCredentialForProject(adminActor, ids.project),
    ]);
    expect(created.filter((item) => item.status === "fulfilled")).toHaveLength(1);
    expect(created.filter((item) => item.status === "rejected")).toHaveLength(1);
    const active = await owner.query<{ id: string }>(
      `SELECT id FROM "UniversalConnectorCredential" WHERE "bindingId" = $1 AND "revokedAt" IS NULL ORDER BY "createdAt"`,
      [ids.binding],
    );
    expect(active.rows).toHaveLength(2);
    const revoked = await Promise.allSettled(
      active.rows.map((credential) =>
        revokeUniversalCredential(adminActor, ids.project, credential.id),
      ),
    );
    expect(revoked.filter((item) => item.status === "fulfilled")).toHaveLength(1);
    expect(revoked.filter((item) => item.status === "rejected")).toHaveLength(1);
    const remaining = await owner.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM "UniversalConnectorCredential" WHERE "bindingId" = $1 AND "revokedAt" IS NULL`,
      [ids.binding],
    );
    expect(remaining.rows[0]?.count).toBe("1");
  });

});

async function exchangeFor(externalUserId: string, name: string) {
  const launch = await issueTicket(externalUserId, { name });
  const ticket = decodeURIComponent(
    new URL(launch.launchUrl).hash.slice("#ticket=".length),
  );
  const exchanged = await exchangeUniversalTicket(
    request("https://support.example.test/api/v1/embed/universal/exchange"),
    {
      publicId: ids.publicId,
      ticket,
      parentOrigin: "https://app.example.test",
    },
  );
  return {
    id: exchanged.contact.id,
    bindingId: ids.binding,
    externalUserId,
    name,
    email: null,
    username: null,
    sourceKey: UNIVERSAL_PLUGIN_KEY,
    sourceLabel: "通用工单连接器",
    projectId: ids.project,
    customerSpaceId,
  };
}

function issueTicket(
  externalUserId: string,
  user: {
    name: string;
    email?: string;
    avatarUrl?: string;
    attributes?: Record<string, string | number | boolean>;
  },
  credential: { clientId: string; clientSecret: string } = {
    clientId,
    clientSecret,
  },
  context: {
    theme?: "light" | "dark" | "system";
    locale?: string;
    returnOrigin?: string;
  } = {},
) {
  return createUniversalLaunchTicket(
    request("https://support.example.test/api/v1/integrations/universal/launch-tickets", {
      Authorization: `Basic ${Buffer.from(`${credential.clientId}:${credential.clientSecret}`).toString("base64")}`,
    }),
    {
      user: {
        id: externalUserId,
        name: user.name,
        email: user.email ?? null,
        username: null,
        avatarUrl: user.avatarUrl ?? null,
        attributes: user.attributes ?? {},
      },
      context,
    },
  );
}

function request(url: string, headers?: Record<string, string>) {
  return new Request(url, { method: "POST", headers });
}
