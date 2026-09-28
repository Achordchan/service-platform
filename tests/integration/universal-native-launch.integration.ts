import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { GET as embedAttachmentRoute } from "@/app/api/v1/embed/attachments/[attachmentId]/route";
import { POST as downloadLinkRoute } from "@/app/api/v1/embed/attachments/[attachmentId]/download-link/route";
import { POST as exchangeTicketRoute } from "@/app/api/v1/embed/universal/exchange/route";
import { GET as contactUnreadRoute } from "@/app/api/v1/integrations/universal/contacts/[externalUserId]/unread/route";
import type { Actor } from "@/lib/actor";
import { checkRateLimit } from "@/lib/rate-limit";
import { UNIVERSAL_IN_APP_MAIL_NOTICE } from "@/modules/integrations/external/action-url";
import {
  createExternalRequest,
  getExternalRequest,
} from "@/modules/integrations/external/request-service";
import {
  checkUniversalIntegration,
  createUniversalCredentialForProject,
  getUniversalIntegration,
  saveUniversalIntegration,
} from "@/modules/integrations/universal/connection-service";
import {
  UNIVERSAL_PLUGIN_KEY,
  UNIVERSAL_UNREAD_RATE_LIMIT,
  UNIVERSAL_RATE_WINDOW_MS,
} from "@/modules/integrations/universal/constants";
import {
  createUniversalCredential,
  createUniversalTicket,
} from "@/modules/integrations/universal/security";
import {
  createUniversalLaunchTicket,
  exchangeUniversalTicket,
} from "@/modules/integrations/universal/ticket-service";
import { universalUnreadRateLimitKey } from "@/modules/integrations/universal/unread-service";
import { ensurePluginInstallations } from "@/modules/plugins/plugin-installation-service";
import { addRequestMessage } from "@/modules/requests/request-command-service";

const owner = new Pool({
  connectionString: process.env.DATABASE_MIGRATION_URL,
  max: 1,
});

// native：只开 Native Launch、不配 Origin；web：只配 Origin、未开 Native Launch
const native = {
  project: randomUUID(),
  binding: randomUUID(),
  publicId: randomUUID(),
  clientId: "",
  clientSecret: "",
};
const web = {
  project: randomUUID(),
  binding: randomUUID(),
  publicId: randomUUID(),
  clientId: "",
  clientSecret: "",
};
const setupProject = randomUUID();

let previousPlugin: { enabled: boolean; healthStatus: string };
let adminActor: Actor;
let managerActor: Actor;
let customerSpaceId = "";
let serviceTypeId = "";
let categoryId = "";

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
  for (const [fixture, title, origins, allowNative] of [
    [native, "Native Launch 集成测试", [], true],
    [web, "Native Launch 对照连接", ["https://app.example.test"], false],
  ] as const) {
    await owner.query(
      `INSERT INTO "Project" (id, title, status, kind, "customerSpaceId", "serviceTypeId", "createdById", "updatedAt") VALUES ($1, $2, 'ACTIVE', 'EXTERNAL_INTEGRATION', $3, $4, $5, NOW())`,
      [fixture.project, title, customerSpaceId, serviceTypeId, adminActor.id],
    );
    await owner.query(
      `INSERT INTO "ProjectPluginBinding" (id, "projectId", "pluginKey", "externalConnectorSlot", "publicId", status, "updatedAt") VALUES ($1, $2, $3, 'PRIMARY', $4, 'ACTIVE', NOW())`,
      [fixture.binding, fixture.project, UNIVERSAL_PLUGIN_KEY, fixture.publicId],
    );
    await owner.query(
      `INSERT INTO "ProjectStaff" (id, "projectId", "userId", role) VALUES ($1, $2, $3, 'PROJECT_MANAGER')`,
      [randomUUID(), fixture.project, adminActor.id],
    );
    await owner.query(
      `INSERT INTO "UniversalConnectorConnection" ("bindingId", name, "allowedOrigins", "allowNativeLaunch", "profileFields", "webhookUrl", "webhookSecretEncrypted", "webhookEvents", "webhookStatus", "healthStatus", "updatedAt") VALUES ($1, $2, $3::jsonb, $4, '[]'::jsonb, 'https://webhook.example.test/achord', 'encrypted-test-value', '["request.created","request.public_message.created","request.status.changed","request.unread.changed"]'::jsonb, 'UNVERIFIED', 'READY', NOW())`,
      [fixture.binding, title, JSON.stringify(origins), allowNative],
    );
    const credential = createUniversalCredential();
    fixture.clientId = credential.clientId;
    fixture.clientSecret = credential.clientSecret;
    await owner.query(
      `INSERT INTO "UniversalConnectorCredential" (id, "bindingId", "clientId", "secretHash", "secretPrefix") VALUES ($1, $2, $3, $4, $5)`,
      [
        randomUUID(),
        fixture.binding,
        credential.clientId,
        credential.secretHash,
        credential.secretPrefix,
      ],
    );
  }
  await owner.query(
    `INSERT INTO "Project" (id, title, status, kind, "customerSpaceId", "serviceTypeId", "createdById", "updatedAt") VALUES ($1, 'Native Launch 检测激活', 'DRAFT', 'EXTERNAL_INTEGRATION', $2, $3, $4, NOW())`,
    [setupProject, customerSpaceId, serviceTypeId, adminActor.id],
  );
  await owner.query(
    `INSERT INTO "ProjectStaff" (id, "projectId", "userId", role) VALUES ($1, $2, $3, 'PROJECT_MANAGER')`,
    [randomUUID(), setupProject, adminActor.id],
  );
});

afterAll(async () => {
  const projects = [native.project, web.project, setupProject];
  await owner.query(
    `UPDATE "AuditLog" SET "externalActorId" = NULL WHERE "projectId" = ANY($1::text[])`,
    [projects],
  );
  await owner.query(`DELETE FROM "Project" WHERE id = ANY($1::text[])`, [
    projects,
  ]);
  await owner.query(
    `UPDATE "PluginInstallation" SET enabled = $2, "healthStatus" = $3, "updatedAt" = NOW() WHERE key = $1`,
    [UNIVERSAL_PLUGIN_KEY, previousPlugin.enabled, previousPlugin.healthStatus],
  );
  await owner.end();
});

describe("Achord Connect Native Launch", () => {
  it("连接未开启 Native Launch 时拒绝创建 native 票据", async () => {
    await expect(
      issueTicket(web, `web-${randomUUID()}`, { launchMode: "native" }),
    ).rejects.toMatchObject({
      code: "UNIVERSAL_NATIVE_LAUNCH_DISABLED",
      status: 403,
    });
  });

  it("native 票据不接受 returnOrigin", async () => {
    await expect(
      issueTicket(native, `native-${randomUUID()}`, {
        launchMode: "native",
        returnOrigin: "https://app.example.test",
      }),
    ).rejects.toMatchObject({
      code: "UNIVERSAL_RETURN_ORIGIN_NOT_ALLOWED_FOR_NATIVE",
      status: 422,
    });
  });

  it("未配置 Origin 的连接不能签 iframe 票据", async () => {
    await expect(
      issueTicket(native, `native-${randomUUID()}`),
    ).rejects.toMatchObject({
      code: "UNIVERSAL_IFRAME_NOT_CONFIGURED",
      status: 409,
    });
  });

  it("native 票据只放在片段里，不带父页面 Origin 即可兑换一次", async () => {
    const externalUserId = `native-${randomUUID()}`;
    const launch = await issueTicket(native, externalUserId, {
      launchMode: "native",
      theme: "dark",
    });
    const url = new URL(launch.launchUrl);
    expect(url.search).toBe("");
    expect(url.pathname).toBe(`/embed/connect/${native.publicId}`);
    const fragment = new URLSearchParams(url.hash.slice(1));
    expect(fragment.get("mode")).toBe("native");
    expect(fragment.get("ticket")).toMatch(/^act_/);
    expect(new Date(launch.expiresAt).getTime() - Date.now()).toBeLessThanOrEqual(
      60_000,
    );
    const stored = await owner.query<{ launchMode: string; context: unknown }>(
      `SELECT "launchMode", context FROM "UniversalLaunchTicket" WHERE "bindingId" = $1 AND "externalUserId" = $2`,
      [native.binding, externalUserId],
    );
    expect(stored.rows[0]).toEqual({
      launchMode: "native",
      context: { theme: "dark" },
    });

    const ticket = fragment.get("ticket")!;
    const response = await exchangeTicketRoute(
      jsonRequest("https://support.example.test/api/v1/embed/universal/exchange", {
        publicId: native.publicId,
        ticket,
      }),
    );
    expect(response.status).toBe(200);
    const { data } = (await response.json()) as {
      data: {
        launchMode: string;
        parentOrigins: string[];
        contact: { id: string };
        context: Record<string, unknown>;
      };
    };
    expect(data).toMatchObject({
      launchMode: "native",
      parentOrigins: [],
      context: { theme: "dark" },
    });
    const session = await owner.query<{ launchMode: string }>(
      `SELECT "launchMode" FROM "ExternalEmbedSession" WHERE "externalContactId" = $1`,
      [data.contact.id],
    );
    expect(session.rows.map((item) => item.launchMode)).toEqual(["native"]);
    const contact = await owner.query<{ lastParentOrigin: string | null }>(
      `SELECT "lastParentOrigin" FROM "ExternalContact" WHERE id = $1`,
      [data.contact.id],
    );
    expect(contact.rows[0]?.lastParentOrigin).toBeNull();

    await expect(
      exchangeUniversalTicket(request(), {
        publicId: native.publicId,
        ticket,
      }),
    ).rejects.toMatchObject({ code: "UNIVERSAL_TICKET_INVALID", status: 401 });
  });

  it("native 兑换忽略前端传来的 parentOrigin，不改写 iframe 的来源信任记录", async () => {
    const externalUserId = `native-origin-${randomUUID()}`;
    await owner.query(
      `UPDATE "UniversalConnectorConnection" SET "allowNativeLaunch" = true WHERE "bindingId" = $1`,
      [web.binding],
    );
    try {
      const viaIframe = await exchangeFor(web, externalUserId, {
        parentOrigin: "https://app.example.test",
      });
      const lastParentOrigin = async () =>
        (
          await owner.query<{ lastParentOrigin: string | null }>(
            `SELECT "lastParentOrigin" FROM "ExternalContact" WHERE id = $1`,
            [viaIframe.contact.id],
          )
        ).rows[0]?.lastParentOrigin;
      expect(await lastParentOrigin()).toBe("https://app.example.test");
      for (const parentOrigin of [undefined, "https://evil.example.test"]) {
        const viaNative = await exchangeFor(web, externalUserId, {
          launchMode: "native",
          parentOrigin,
        });
        expect(viaNative.contact.id).toBe(viaIframe.contact.id);
        expect(viaNative.parentOrigins).toEqual([]);
        expect(await lastParentOrigin()).toBe("https://app.example.test");
      }
    } finally {
      await owner.query(
        `UPDATE "UniversalConnectorConnection" SET "allowNativeLaunch" = false WHERE "bindingId" = $1`,
        [web.binding],
      );
    }
  });

  it("过期的 native 票据不能兑换", async () => {
    const externalUserId = `native-expired-${randomUUID()}`;
    const launch = await issueTicket(native, externalUserId, {
      launchMode: "native",
    });
    await owner.query(
      `UPDATE "UniversalLaunchTicket" SET "createdAt" = (now() AT TIME ZONE 'UTC') - INTERVAL '2 minutes', "expiresAt" = (now() AT TIME ZONE 'UTC') - INTERVAL '1 minute' WHERE "bindingId" = $1 AND "externalUserId" = $2`,
      [native.binding, externalUserId],
    );
    await expect(
      exchangeUniversalTicket(request(), {
        publicId: native.publicId,
        ticket: ticketOf(launch.launchUrl),
      }),
    ).rejects.toMatchObject({ code: "UNIVERSAL_TICKET_INVALID", status: 401 });
  });

  it("native 票据沿用同一套每用户限流", async () => {
    const externalUserId = `native-limited-${randomUUID()}`;
    for (let index = 0; index < 20; index += 1) {
      await owner.query(
        `INSERT INTO "UniversalLaunchTicket" (id, "bindingId", "ticketHash", "externalUserId", profile, context, "launchMode", "expiresAt") VALUES ($1, $2, $3, $4, $5::jsonb, '{}'::jsonb, 'native', NOW() + INTERVAL '60 seconds')`,
        [
          randomUUID(),
          native.binding,
          createUniversalTicket().ticketHash,
          externalUserId,
          JSON.stringify({ id: externalUserId, name: "限流用户", email: null, username: null, avatarUrl: null, attributes: {} }),
        ],
      );
    }
    await expect(
      issueTicket(native, externalUserId, { launchMode: "native" }),
    ).rejects.toMatchObject({ code: "UNIVERSAL_RATE_LIMITED", status: 429 });
  });

  it("前端把 iframe 票据改成 mode=native 也不能免去父页面来源校验", async () => {
    const launch = await issueTicket(web, `downgrade-${randomUUID()}`);
    expect(launch.launchUrl).not.toContain("mode=native");
    // 攻击者在片段里追加 mode=native：门户于是不带 parentOrigin 去兑换
    const tampered = new URLSearchParams(
      new URL(`${launch.launchUrl}&mode=native`).hash.slice(1),
    );
    expect(tampered.get("mode")).toBe("native");
    const ticket = tampered.get("ticket")!;
    const response = await exchangeTicketRoute(
      jsonRequest("https://support.example.test/api/v1/embed/universal/exchange", {
        publicId: web.publicId,
        ticket,
      }),
    );
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "UNIVERSAL_PARENT_ORIGIN_REQUIRED" },
    });
    // 被拒绝的尝试不消耗票据，合法宿主仍能兑换
    const exchanged = await exchangeUniversalTicket(request(), {
      publicId: web.publicId,
      ticket,
      parentOrigin: "https://app.example.test",
    });
    expect(exchanged.launchMode).toBe("iframe");
    expect(exchanged.parentOrigins).toEqual(["https://app.example.test"]);
  });

  it("只开 Native Launch、不配 Origin 的连接能通过检测并激活；切换开关撤销会话并要求重新检测", async () => {
    await expect(
      saveUniversalIntegration(adminActor, setupProject, connectionInput({
        allowedOrigins: [],
      })),
    ).rejects.toMatchObject({
      code: "UNIVERSAL_LAUNCH_TARGET_REQUIRED",
      status: 422,
    });
    const saved = await saveUniversalIntegration(
      adminActor,
      setupProject,
      connectionInput({ allowedOrigins: [], allowNativeLaunch: true }),
    );
    expect(saved.connection).toMatchObject({
      allowedOrigins: [],
      allowNativeLaunch: true,
    });
    await createUniversalCredentialForProject(adminActor, setupProject);
    const checked = await checkUniversalIntegration(adminActor, setupProject);
    expect(checked.healthStatus).toBe("READY");
    const activated = await saveUniversalIntegration(
      adminActor,
      setupProject,
      connectionInput({ allowedOrigins: [], activate: true }),
    );
    // 省略 allowNativeLaunch 时保留现值
    expect(activated.connection).toMatchObject({
      bindingStatus: "ACTIVE",
      allowNativeLaunch: true,
    });

    // 再加一个 Origin（Origin 变化本身就要求重新检测），重新检测并激活，
    // 这样下面只切换 Native Launch 开关时，Origin 保持不变
    await saveUniversalIntegration(
      adminActor,
      setupProject,
      connectionInput({ allowedOrigins: ["https://app.example.test"] }),
    );
    await checkUniversalIntegration(adminActor, setupProject);
    await saveUniversalIntegration(
      adminActor,
      setupProject,
      connectionInput({
        allowedOrigins: ["https://app.example.test"],
        activate: true,
      }),
    );

    const bindingId = activated.connection.bindingId;
    const beforeToggle = await owner.query<{ status: string; healthStatus: string }>(
      `SELECT binding.status, connection."healthStatus" FROM "ProjectPluginBinding" binding JOIN "UniversalConnectorConnection" connection ON connection."bindingId" = binding.id WHERE binding.id = $1`,
      [bindingId],
    );
    expect(beforeToggle.rows[0]).toEqual({ status: "ACTIVE", healthStatus: "READY" });
    const sessionId = randomUUID();
    const contactId = randomUUID();
    await owner.query(
      `INSERT INTO "ExternalContact" (id, "bindingId", "externalUserId", "displayName", "updatedAt") VALUES ($1, $2, $3, '切换开关联系人', NOW())`,
      [contactId, bindingId, `toggle-${randomUUID()}`],
    );
    await owner.query(
      `INSERT INTO "ExternalEmbedSession" (id, "tokenHash", "externalContactId", "bindingId", "expiresAt", "launchMode") VALUES ($1, $2, $3, $4, NOW() + INTERVAL '1 hour', 'native')`,
      [sessionId, randomUUID(), contactId, bindingId],
    );
    const toggled = await saveUniversalIntegration(
      adminActor,
      setupProject,
      connectionInput({
        allowedOrigins: ["https://app.example.test"],
        allowNativeLaunch: false,
      }),
    );
    expect(toggled.connection).toMatchObject({
      allowNativeLaunch: false,
      healthStatus: "UNKNOWN",
    });
    const binding = await owner.query<{ status: string }>(
      `SELECT status FROM "ProjectPluginBinding" WHERE id = $1`,
      [bindingId],
    );
    expect(binding.rows[0]?.status).toBe("DISABLED");
    const revoked = await owner.query<{ revokedAt: Date | null }>(
      `SELECT "revokedAt" FROM "ExternalEmbedSession" WHERE id = $1`,
      [sessionId],
    );
    expect(revoked.rows[0]?.revokedAt).not.toBeNull();
    await expect(
      saveUniversalIntegration(
        adminActor,
        setupProject,
        connectionInput({
          allowedOrigins: ["https://app.example.test"],
          activate: true,
        }),
      ),
    ).rejects.toMatchObject({ code: "UNIVERSAL_CONNECTION_NOT_VERIFIED" });
  });

  it("员工端最近会话能区分 iframe 与 native", async () => {
    await exchangeFor(web, `recent-web-${randomUUID()}`, {
      parentOrigin: "https://app.example.test",
    });
    const view = await getUniversalIntegration(managerActor, web.project);
    expect(view.connection?.recentSessions?.[0]).toMatchObject({
      launchMode: "iframe",
      status: "ACTIVE",
    });
    const nativeView = await getUniversalIntegration(
      managerActor,
      native.project,
    );
    expect(
      nativeView.connection?.recentSessions?.map((item) => item.launchMode),
    ).toContain("native");
    expect(nativeView.connection?.allowNativeLaunch).toBe(true);
  });

  it("未读查询：认证、跨连接隔离、不存在联系人返回 0、Webhook 带联系人未读总数", async () => {
    const externalUserId = `unread-${randomUUID()}`;
    const exchanged = await exchangeFor(native, externalUserId, {
      launchMode: "native",
    });
    const actor = externalActorFor(native, exchanged.contact.id, externalUserId);
    const first = await createExternalRequest(
      actor,
      { title: "未读一", description: "<p>一</p>", categoryId, priority: "NORMAL" },
      { customerMemberNotificationsEnabled: false },
    );
    const second = await createExternalRequest(
      actor,
      { title: "未读二", description: "<p>二</p>", categoryId, priority: "NORMAL" },
      { customerMemberNotificationsEnabled: false },
    );
    await addRequestMessage(adminActor, first.id, {
      body: "<p>第一条回复</p>",
      visibility: "CUSTOMER_VISIBLE",
    });
    await addRequestMessage(adminActor, second.id, {
      body: "<p>第二条回复</p>",
      visibility: "CUSTOMER_VISIBLE",
    });
    await addRequestMessage(adminActor, second.id, {
      body: "<p>第三条回复</p>",
      visibility: "CUSTOMER_VISIBLE",
    });

    const unauthenticated = await contactUnreadRoute(
      new Request(unreadUrl(externalUserId)),
      unreadParams(externalUserId),
    );
    expect(unauthenticated.status).toBe(401);
    const wrongSecret = await contactUnreadRoute(
      unreadRequest(externalUserId, { ...native, clientSecret: "acs_wrong" }),
      unreadParams(externalUserId),
    );
    expect(wrongSecret.status).toBe(401);

    const response = await contactUnreadRoute(
      unreadRequest(externalUserId, native),
      unreadParams(externalUserId),
    );
    expect(response.status).toBe(200);
    const { data } = (await response.json()) as {
      data: {
        externalUserId: string;
        unreadCount: number;
        requests: Array<{ id: string; unreadCount: number; number: string; title: string; status: string; updatedAt: string }>;
      };
    };
    expect(data.externalUserId).toBe(externalUserId);
    expect(data.unreadCount).toBe(3);
    expect(data.requests.map((item) => [item.id, item.unreadCount])).toEqual([
      [second.id, 2],
      [first.id, 1],
    ]);
    expect(data.requests[0]).toMatchObject({
      number: expect.any(String),
      title: "未读二",
      updatedAt: expect.any(String),
    });

    // 同一个 externalUserId 用另一个连接的凭据查：看不到这个连接的联系人
    const isolated = await contactUnreadRoute(
      unreadRequest(externalUserId, web),
      unreadParams(externalUserId),
    );
    expect(isolated.status).toBe(200);
    await expect(isolated.json()).resolves.toEqual({
      data: { externalUserId, unreadCount: 0, requests: [] },
    });
    const missingUserId = `missing-${randomUUID()}`;
    const missing = await contactUnreadRoute(
      unreadRequest(missingUserId, native),
      unreadParams(missingUserId),
    );
    await expect(missing.json()).resolves.toEqual({
      data: { externalUserId: missingUserId, unreadCount: 0, requests: [] },
    });

    const unreadEvents = async () =>
      (
        await owner.query<{
          payload: {
            data: {
              unreadCount: number;
              contactUnreadCount: number;
              request: { id: string };
            };
          };
        }>(
          `SELECT payload FROM "UniversalWebhookDelivery" WHERE "bindingId" = $1 AND "eventType" = 'request.unread.changed' AND payload->'data'->>'externalUserId' = $2 ORDER BY "createdAt", id`,
          [native.binding, externalUserId],
        )
      ).rows.map((item) => ({
        requestId: item.payload.data.request.id,
        unreadCount: item.payload.data.unreadCount,
        contactUnreadCount: item.payload.data.contactUnreadCount,
      }));
    expect(await unreadEvents()).toEqual([
      { requestId: first.id, unreadCount: 1, contactUnreadCount: 1 },
      { requestId: second.id, unreadCount: 1, contactUnreadCount: 2 },
      { requestId: second.id, unreadCount: 2, contactUnreadCount: 3 },
    ]);
    await getExternalRequest(actor, second.id);
    expect((await unreadEvents()).at(-1)).toEqual({
      requestId: second.id,
      unreadCount: 0,
      contactUnreadCount: 1,
    });
  });

  it("未读查询按连接每分钟 600 次限流", async () => {
    const key = universalUnreadRateLimitKey(web.binding);
    while (checkRateLimit(key, UNIVERSAL_UNREAD_RATE_LIMIT, UNIVERSAL_RATE_WINDOW_MS)) {
      // 预先把本连接的窗口打满
    }
    const limited = await contactUnreadRoute(
      unreadRequest("anyone", web),
      unreadParams("anyone"),
    );
    expect(limited.status).toBe(429);
    await expect(limited.json()).resolves.toMatchObject({
      error: { code: "UNIVERSAL_RATE_LIMITED" },
    });
    // 其他连接不受影响
    const other = await contactUnreadRoute(
      unreadRequest("anyone", native),
      unreadParams("anyone"),
    );
    expect(other.status).toBe(200);
  });

  it("附件签名下载链接只签给 native 会话，兑现时按会话现状重新鉴权", async () => {
    const nativeSession = await exchangeFor(native, `download-${randomUUID()}`, {
      launchMode: "native",
    });
    const iframeSession = await exchangeFor(web, `download-${randomUUID()}`, {
      parentOrigin: "https://app.example.test",
    });
    const attachmentId = randomUUID();
    const params = { params: Promise.resolve({ attachmentId }) };
    const embedPost = (token: string) =>
      new Request(
        `https://support.example.test/api/v1/embed/attachments/${attachmentId}/download-link`,
        { method: "POST", headers: { Authorization: `Embed ${token}` } },
      );

    const refused = await downloadLinkRoute(embedPost(iframeSession.token), params);
    expect(refused.status).toBe(403);
    await expect(refused.json()).resolves.toMatchObject({
      error: { code: "EMBED_DOWNLOAD_LINK_NATIVE_ONLY" },
    });

    const issued = await downloadLinkRoute(embedPost(nativeSession.token), params);
    expect(issued.status).toBe(200);
    const { data } = (await issued.json()) as { data: { url: string } };
    expect(data.url).toMatch(
      new RegExp(`^/api/v1/embed/attachments/${attachmentId}\\?download=`),
    );
    // 系统浏览器里没有 Authorization 头：链接本身通过会话鉴权后才去查附件
    const redeemed = await embedAttachmentRoute(
      new Request(`https://support.example.test${data.url}`),
      params,
    );
    expect(redeemed.status).toBe(404);
    await expect(redeemed.json()).resolves.toMatchObject({
      error: { code: "ATTACHMENT_NOT_FOUND" },
    });
    const forged = await embedAttachmentRoute(
      new Request(`https://support.example.test${data.url}x`),
      params,
    );
    expect(forged.status).toBe(401);
    await owner.query(
      `UPDATE "ExternalEmbedSession" SET "revokedAt" = (now() AT TIME ZONE 'UTC') WHERE "externalContactId" = $1`,
      [nativeSession.contact.id],
    );
    const afterRevoke = await embedAttachmentRoute(
      new Request(`https://support.example.test${data.url}`),
      params,
    );
    expect(afterRevoke.status).toBe(401);
  });

  it("只用过 native 的联系人、连接没有 Origin 时邮件不放返回链接，改为应用内提示", async () => {
    const externalUserId = `mail-${randomUUID()}`;
    const email = `${externalUserId}@example.test`;
    const exchanged = await exchangeFor(native, externalUserId, {
      launchMode: "native",
      email,
    });
    const actor = externalActorFor(native, exchanged.contact.id, externalUserId);
    const created = await createExternalRequest(
      actor,
      { title: "邮件提示", description: "<p>邮件</p>", categoryId, priority: "NORMAL" },
      { customerMemberNotificationsEnabled: false },
    );
    const reply = await addRequestMessage(adminActor, created.id, {
      body: "<p>请查看处理结果</p>",
      visibility: "CUSTOMER_VISIBLE",
    });
    const mail = await owner.query<{
      templateKey: string;
      body: string;
      actionUrl: string | null;
      actionLabel: string | null;
    }>(
      `SELECT "templateKey", body, "actionUrl", "actionLabel" FROM "MailMessage" WHERE "toEmail" = $1 AND "sourceId" = $2`,
      [email, reply.message.id],
    );
    expect(mail.rows).toHaveLength(1);
    expect(mail.rows[0]).toMatchObject({
      templateKey: "EXTERNAL_REQUEST_PUBLIC_REPLY",
      actionUrl: null,
      actionLabel: null,
    });
    expect(mail.rows[0].body.endsWith(`\n\n${UNIVERSAL_IN_APP_MAIL_NOTICE}`)).toBe(
      true,
    );
  });
});

type Fixture = typeof native;

function issueTicket(
  fixture: Fixture,
  externalUserId: string,
  context: {
    launchMode?: "iframe" | "native";
    theme?: "light" | "dark" | "system";
    returnOrigin?: string;
  } = {},
  user: { email?: string } = {},
) {
  return createUniversalLaunchTicket(
    request({
      Authorization: basicAuth(fixture),
    }),
    {
      user: {
        id: externalUserId,
        name: `用户 ${externalUserId.slice(0, 12)}`,
        email: user.email ?? null,
        username: null,
        avatarUrl: null,
        attributes: {},
      },
      context,
    },
  );
}

async function exchangeFor(
  fixture: Fixture,
  externalUserId: string,
  options: {
    launchMode?: "native";
    parentOrigin?: string;
    email?: string;
  },
) {
  const launch = await issueTicket(
    fixture,
    externalUserId,
    options.launchMode ? { launchMode: options.launchMode } : {},
    { email: options.email },
  );
  return exchangeUniversalTicket(request(), {
    publicId: fixture.publicId,
    ticket: ticketOf(launch.launchUrl),
    parentOrigin: options.parentOrigin,
  });
}

function externalActorFor(
  fixture: Fixture,
  contactId: string,
  externalUserId: string,
) {
  return {
    id: contactId,
    bindingId: fixture.binding,
    externalUserId,
    name: `用户 ${externalUserId.slice(0, 12)}`,
    email: null,
    username: null,
    sourceKey: UNIVERSAL_PLUGIN_KEY,
    sourceLabel: "通用工单连接器",
    projectId: fixture.project,
    customerSpaceId,
  };
}

function connectionInput(input: {
  allowedOrigins: string[];
  allowNativeLaunch?: boolean;
  activate?: boolean;
}) {
  return {
    name: "Native Launch 检测激活",
    profileFields: [],
    emailNotificationsEnabled: true,
    customerMemberNotificationsEnabled: false,
    webhookUrl: null,
    webhookEvents: [],
    ...input,
  };
}

function ticketOf(launchUrl: string) {
  return new URLSearchParams(new URL(launchUrl).hash.slice(1)).get("ticket")!;
}

function basicAuth(fixture: { clientId: string; clientSecret: string }) {
  return `Basic ${Buffer.from(`${fixture.clientId}:${fixture.clientSecret}`).toString("base64")}`;
}

function unreadUrl(externalUserId: string) {
  return `https://support.example.test/api/v1/integrations/universal/contacts/${encodeURIComponent(externalUserId)}/unread`;
}

function unreadRequest(
  externalUserId: string,
  fixture: { clientId: string; clientSecret: string },
) {
  return new Request(unreadUrl(externalUserId), {
    headers: { Authorization: basicAuth(fixture) },
  });
}

function unreadParams(externalUserId: string) {
  return { params: Promise.resolve({ externalUserId }) };
}

function jsonRequest(url: string, body: unknown) {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function request(headers?: Record<string, string>) {
  return new Request(
    "https://support.example.test/api/v1/integrations/universal/launch-tickets",
    { method: "POST", headers },
  );
}
