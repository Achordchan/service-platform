import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { createExternalRequest } from "@/modules/integrations/external/request-service";
import { UNIVERSAL_PLUGIN_KEY } from "@/modules/integrations/universal/constants";
import { ensurePluginInstallations } from "@/modules/plugins/plugin-installation-service";

// 生产事故回归：开启内容风控后，外部联系人提交服务请求会带风控复查单，
// 通知不再走聚合 upsert，而是直插 Notification；外部会话没有 app.user_id，
// 被 notification_access 的 WITH CHECK 拒绝，整笔建单 500。

const owner = new Pool({
  connectionString: process.env.DATABASE_MIGRATION_URL,
  max: 1,
});

const ids = {
  project: randomUUID(),
  binding: randomUUID(),
  publicId: randomUUID(),
  contact: randomUUID(),
};
const RISK_KEY = "content-contact-risk";

let staffUserId = "";
let customerSpaceId = "";
let categoryId = "";
let previousPlugins: Array<{
  key: string;
  enabled: boolean;
  healthStatus: string;
  config: unknown;
}> = [];
let previousRuntime: Record<string, unknown> | null = null;

beforeAll(async () => {
  await ensurePluginInstallations();
  previousPlugins = (
    await owner.query(
      `SELECT key, enabled, "healthStatus", config FROM "PluginInstallation" WHERE key = ANY($1::text[])`,
      [[UNIVERSAL_PLUGIN_KEY, RISK_KEY]],
    )
  ).rows;
  previousRuntime =
    (
      await owner.query(
        `SELECT * FROM "ContentRiskRuntimeState" WHERE "pluginKey" = $1`,
        [RISK_KEY],
      )
    ).rows[0] ?? null;

  await owner.query(
    `UPDATE "PluginInstallation" SET enabled = true, "healthStatus" = 'READY', "updatedAt" = NOW() WHERE key = $1`,
    [UNIVERSAL_PLUGIN_KEY],
  );
  await owner.query(
    `UPDATE "PluginInstallation"
     SET enabled = true,
         "healthStatus" = 'READY',
         config = jsonb_build_object(
           'baseUrl', 'https://provider.example.test/v1',
           'model', 'risk-model',
           'fullAuditEnabled', TRUE,
           'allowedDomains', jsonb_build_array()
         ),
         "updatedAt" = NOW()
     WHERE key = $1`,
    [RISK_KEY],
  );
  await owner.query(
    `INSERT INTO "ContentRiskRuntimeState" ("pluginKey", "activationId", "enabledAt", "updatedAt")
     VALUES ($1, 'external-request-risk-test', (NOW() AT TIME ZONE 'UTC') - INTERVAL '1 minute', NOW())
     ON CONFLICT ("pluginKey") DO UPDATE SET
       "activationId" = EXCLUDED."activationId",
       "enabledAt" = EXCLUDED."enabledAt",
       "bypassedAt" = NULL,
       "updatedAt" = NOW()`,
    [RISK_KEY],
  );

  const base = await owner.query<{
    customerSpaceId: string;
    serviceTypeId: string;
    categoryId: string;
    createdById: string;
  }>(`
    SELECT project."customerSpaceId", project."serviceTypeId",
           category.id AS "categoryId", project."createdById"
    FROM "Project" project
    JOIN "RequestCategory" category
      ON category."serviceTypeId" = project."serviceTypeId" AND category.active = true
    LIMIT 1
  `);
  const row = base.rows[0];
  if (!row) throw new Error("请先执行 pnpm test:integration:prepare");
  customerSpaceId = row.customerSpaceId;
  categoryId = row.categoryId;
  staffUserId = row.createdById;

  await owner.query(
    `INSERT INTO "Project" (id, title, status, kind, "customerSpaceId", "serviceTypeId", "createdById", "updatedAt")
     VALUES ($1, '外部建单风控通知回归', 'ACTIVE', 'EXTERNAL_INTEGRATION', $2, $3, $4, NOW())`,
    [ids.project, customerSpaceId, row.serviceTypeId, staffUserId],
  );
  await owner.query(
    `INSERT INTO "ProjectPluginBinding" (id, "projectId", "pluginKey", "externalConnectorSlot", "publicId", status, "updatedAt")
     VALUES ($1, $2, $3, 'PRIMARY', $4, 'ACTIVE', NOW())`,
    [ids.binding, ids.project, UNIVERSAL_PLUGIN_KEY, ids.publicId],
  );
  // 项目负责人是通知收件人：没有收件人就不会走到插入通知这一步
  await owner.query(
    `INSERT INTO "ProjectStaff" (id, "projectId", "userId", role) VALUES ($1, $2, $3, 'PROJECT_MANAGER')`,
    [randomUUID(), ids.project, staffUserId],
  );
  await owner.query(
    `INSERT INTO "UniversalConnectorConnection" ("bindingId", name, "allowedOrigins", "allowNativeLaunch", "profileFields", "healthStatus", "updatedAt")
     VALUES ($1, '风控回归连接', '[]'::jsonb, true, '[]'::jsonb, 'READY', NOW())`,
    [ids.binding],
  );
  await owner.query(
    `INSERT INTO "ExternalContact" (id, "bindingId", "externalUserId", "displayName", "updatedAt")
     VALUES ($1, $2, $3, '风控回归用户', NOW())`,
    [ids.contact, ids.binding, `risk-${randomUUID()}`],
  );
});

afterAll(async () => {
  try {
    await owner.query(
      `DELETE FROM "ContentRiskState" WHERE "targetId" IN (SELECT id FROM "ServiceRequest" WHERE "projectId" = $1)`,
      [ids.project],
    );
    await owner.query(
      `DELETE FROM "ContentRiskReview" WHERE "projectId" = $1`,
      [ids.project],
    );
    await owner.query(
      `UPDATE "AuditLog" SET "externalActorId" = NULL WHERE "projectId" = $1`,
      [ids.project],
    );
    await owner.query(`DELETE FROM "Project" WHERE id = $1`, [ids.project]);
  } finally {
    // 插件和风控运行状态必须还原，否则后续套件的公开内容都会被风控拦截
    for (const plugin of previousPlugins) {
      await owner.query(
        `UPDATE "PluginInstallation" SET enabled = $2, "healthStatus" = $3, config = $4, "updatedAt" = NOW() WHERE key = $1`,
        [plugin.key, plugin.enabled, plugin.healthStatus, plugin.config],
      );
    }
    if (previousRuntime) {
      await owner.query(
        `UPDATE "ContentRiskRuntimeState" SET "activationId" = $2, "enabledAt" = $3, "bypassedAt" = $4, "updatedAt" = NOW() WHERE "pluginKey" = $1`,
        [
          RISK_KEY,
          previousRuntime.activationId,
          previousRuntime.enabledAt,
          previousRuntime.bypassedAt,
        ],
      );
    } else {
      await owner.query(
        `DELETE FROM "ContentRiskRuntimeState" WHERE "pluginKey" = $1`,
        [RISK_KEY],
      );
    }
    await owner.end();
  }
});

describe("外部联系人建单 + 内容风控", () => {
  it("带风控复查单时仍能建单，并给项目负责人写入暂缓的通知", async () => {
    const created = await createExternalRequest(
      {
        id: ids.contact,
        bindingId: ids.binding,
        externalUserId: "risk-user",
        name: "风控回归用户",
        email: null,
        username: null,
        sourceKey: UNIVERSAL_PLUGIN_KEY,
        sourceLabel: "通用工单连接器",
        projectId: ids.project,
        customerSpaceId,
      },
      {
        title: "客户端连不上",
        description: "<p>更新后一直显示连接失败</p>",
        categoryId,
        priority: "NORMAL",
      },
      { customerMemberNotificationsEnabled: false },
    );

    const review = await owner.query<{ id: string }>(
      `SELECT id FROM "ContentRiskReview" WHERE "serviceRequestId" = $1`,
      [created.id],
    );
    expect(review.rows).toHaveLength(1);
    const notifications = await owner.query<{
      userId: string;
      contentRiskReviewId: string | null;
      aggregationKey: string | null;
    }>(
      `SELECT "userId", "contentRiskReviewId", "aggregationKey" FROM "Notification" WHERE "serviceRequestId" = $1`,
      [created.id],
    );
    expect(notifications.rows).toContainEqual({
      userId: staffUserId,
      contentRiskReviewId: review.rows[0].id,
      aggregationKey: null,
    });
  });
});
