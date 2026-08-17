import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { DINGTALK_ROBOT_DEFAULT_CONFIG } from "@achord/plugin-dingtalk-robot/config";
import type { Actor } from "@/lib/actor";
import {
  encryptPluginSecretConfig,
  fingerprintPluginConfiguration,
} from "@/modules/plugins/plugin-secret-config";
import {
  applyPluginDisableSideEffects,
  ensurePluginInstallations,
} from "@/modules/plugins/plugin-installation-service";
import { DINGTALK_ROBOT_PLUGIN_KEY } from "@/modules/plugins/plugin-registry";
import { addRequestMessage } from "@/modules/requests/request-command-service";
import { createRequest } from "@/modules/requests/request-service";
import { withSystemDb } from "@/lib/system-db";
import { processDingTalkRobotDelivery } from "@/modules/plugins/dingtalk-robot-service";
import { updateNotificationDeliveryRules } from "@/modules/notifications/notification-delivery-rule-service";
import { assertIntegrationTestDatabase } from "./require-test-database";

assertIntegrationTestDatabase();

const pool = new Pool({
  connectionString: process.env.DATABASE_MIGRATION_URL,
  max: 1,
});

let projectId: string;
let categoryId: string;
let customer: Actor;
let admin: Actor;
let previousInstallation: {
  enabled: boolean;
  healthStatus: string;
  secretConfigEncrypted: string | null;
  healthConfigFingerprint: string | null;
  config: unknown;
} | null = null;
let previousRules: Array<{
  key: string;
  dingtalkEnabled: boolean;
}> = [];
const requestIds: string[] = [];

beforeAll(async () => {
  await ensurePluginInstallations();
  const fixture = await pool.query<{
    project_id: string;
    category_id: string;
    customer_id: string;
    customer_name: string;
    customer_email: string;
    admin_id: string;
    admin_name: string;
    admin_email: string;
  }>(
    `
      SELECT
        project.id AS project_id,
        category.id AS category_id,
        customer.id AS customer_id,
        customer.name AS customer_name,
        customer.email AS customer_email,
        admin.id AS admin_id,
        admin.name AS admin_name,
        admin.email AS admin_email
      FROM "Project" project
      JOIN "RequestCategory" category
        ON category."serviceTypeId" = project."serviceTypeId"
      JOIN "User" customer ON customer.email = 'client@local.test'
      JOIN "User" admin ON admin.email = 'admin@local.test'
      WHERE project.title = '官网 SEO 优化服务'
        AND project.status = 'ACTIVE'
        AND category.active = true
      LIMIT 1
    `,
  );
  const row = fixture.rows[0];
  if (!row) {
    throw new Error("请先准备集成测试数据库与种子数据");
  }
  projectId = row.project_id;
  categoryId = row.category_id;
  customer = {
    id: row.customer_id,
    name: row.customer_name,
    email: row.customer_email,
    platformRole: "CUSTOMER",
    isStaff: false,
    isPlatformAdmin: false,
  };
  admin = {
    id: row.admin_id,
    name: row.admin_name,
    email: row.admin_email,
    platformRole: "PLATFORM_ADMIN",
    isStaff: true,
    isPlatformAdmin: true,
  };

  const installation = await pool.query<{
    enabled: boolean;
    healthStatus: string;
    secretConfigEncrypted: string | null;
    healthConfigFingerprint: string | null;
    config: unknown;
  }>(
    `
      SELECT
        enabled,
        "healthStatus",
        "secretConfigEncrypted",
        "healthConfigFingerprint"
        , config
      FROM "PluginInstallation"
      WHERE key = $1
    `,
    [DINGTALK_ROBOT_PLUGIN_KEY],
  );
  previousInstallation = installation.rows[0] ?? null;
  const rules = await pool.query<{
    key: string;
    dingtalkEnabled: boolean;
  }>(
    `
      SELECT key, "dingtalkEnabled"
      FROM "NotificationDeliveryRule"
      WHERE key = ANY($1::text[])
    `,
    [["REQUEST_CREATED", "REQUEST_PUBLIC_MESSAGE"]],
  );
  previousRules = rules.rows;
});

afterAll(async () => {
  if (requestIds.length > 0) {
    await pool.query(
      `DELETE FROM "DingTalkRobotDelivery" WHERE "requestId" = ANY($1::text[])`,
      [requestIds],
    );
    await pool.query(
      `DELETE FROM "AuditLog" WHERE "serviceRequestId" = ANY($1::text[])`,
      [requestIds],
    );
    await pool.query(
      `DELETE FROM "ServiceRequest" WHERE id = ANY($1::text[])`,
      [requestIds],
    );
  }
  if (previousInstallation) {
    await pool.query(
      `
        UPDATE "PluginInstallation"
        SET
          enabled = $2,
          "healthStatus" = $3,
          "secretConfigEncrypted" = $4,
          "healthConfigFingerprint" = $5,
          config = $6::jsonb,
          "updatedAt" = NOW()
        WHERE key = $1
      `,
      [
        DINGTALK_ROBOT_PLUGIN_KEY,
        previousInstallation.enabled,
        previousInstallation.healthStatus,
        previousInstallation.secretConfigEncrypted,
        previousInstallation.healthConfigFingerprint,
        JSON.stringify(previousInstallation.config),
      ],
    );
  }
  for (const rule of previousRules) {
    await pool.query(
      `
        UPDATE "NotificationDeliveryRule"
        SET "dingtalkEnabled" = $2, "updatedAt" = NOW()
        WHERE key = $1
      `,
      [rule.key, rule.dingtalkEnabled],
    );
  }
  const createdRuleKeys = ["REQUEST_CREATED", "REQUEST_PUBLIC_MESSAGE"].filter(
    (key) => !previousRules.some((rule) => rule.key === key),
  );
  if (createdRuleKeys.length > 0) {
    await pool.query(
      `DELETE FROM "NotificationDeliveryRule" WHERE key = ANY($1::text[])`,
      [createdRuleKeys],
    );
  }
  await pool.end();
});

describe("钉钉机器人宿主接入", () => {
  it("仅规范化同版本配置时保留有效健康状态", async () => {
    await enablePlugin();
    const before = await pool.query<{
      healthConfigFingerprint: string | null;
    }>(
      `SELECT "healthConfigFingerprint" FROM "PluginInstallation" WHERE key = $1`,
      [DINGTALK_ROBOT_PLUGIN_KEY],
    );
    await pool.query(
      `UPDATE "PluginInstallation" SET config = '{}'::jsonb WHERE key = $1`,
      [DINGTALK_ROBOT_PLUGIN_KEY],
    );

    await ensurePluginInstallations();

    const result = await pool.query<{
      enabled: boolean;
      healthStatus: string;
      healthConfigFingerprint: string | null;
      config: unknown;
    }>(
      `
        SELECT enabled, "healthStatus", "healthConfigFingerprint", config
        FROM "PluginInstallation"
        WHERE key = $1
      `,
      [DINGTALK_ROBOT_PLUGIN_KEY],
    );
    expect(result.rows[0]).toMatchObject({
      enabled: true,
      healthStatus: "READY",
      healthConfigFingerprint: before.rows[0]?.healthConfigFingerprint,
    });
    expect(result.rows[0]?.config).toHaveProperty("templates");
  });

  it("启用后为新工单和客户公开回复写入幂等 Outbox", async () => {
    await enablePlugin();
    const created = await createRequest(customer, projectId, {
      categoryId,
      title: `钉钉集成测试 ${randomUUID()}`,
      description: "<p>此正文不得进入钉钉 Outbox。</p>",
      priority: "NORMAL",
    });
    requestIds.push(created.id);

    const reply = await addRequestMessage(customer, created.id, {
      body: "<p>客户补充的正文也不得进入钉钉 Outbox。</p>",
      visibility: "CUSTOMER_VISIBLE",
    });
    expect(reply.deliveryFeedback.dingtalkQueued).toBe(true);

    const result = await pool.query<{
      eventKey: string;
      eventType: string;
      payload: {
        actorName?: string;
        contentSummary?: string;
        occurredAt?: string;
      };
    }>(
      `
        SELECT "eventKey", "eventType", payload
        FROM "DingTalkRobotDelivery"
        WHERE "requestId" = $1
        ORDER BY "createdAt" ASC
      `,
      [created.id],
    );

    expect(result.rows).toHaveLength(2);
    expect(result.rows.map((row) => row.eventType)).toEqual([
      "REQUEST_CREATED",
      "REQUEST_CUSTOMER_REPLIED",
    ]);
    expect(result.rows[0]?.eventKey).toBe(`request-created:${created.id}`);
    expect(result.rows[1]?.eventKey).toBe(`customer-replied:${reply.message.id}`);
    expect(result.rows[0]?.payload.contentSummary).toBeNull();
    expect(result.rows[1]?.payload.contentSummary).toContain("客户补充的正文");
    expect(result.rows[1]?.payload.contentSummary).not.toContain("<p>");
  });

  it("停用插件会跳过待处理投递", async () => {
    await enablePlugin();
    const created = await createRequest(customer, projectId, {
      categoryId,
      title: `钉钉停用测试 ${randomUUID()}`,
      description: "<p>待处理消息</p>",
      priority: "NORMAL",
    });
    requestIds.push(created.id);

    await withSystemDb(async (tx) => {
      await tx.pluginInstallation.update({
        where: { key: DINGTALK_ROBOT_PLUGIN_KEY },
        data: { enabled: false },
      });
      await applyPluginDisableSideEffects(tx, DINGTALK_ROBOT_PLUGIN_KEY);
    });

    const result = await pool.query<{ status: string; lastError: string }>(
      `
        SELECT status, "lastError"
        FROM "DingTalkRobotDelivery"
        WHERE "requestId" = $1
      `,
      [created.id],
    );
    expect(result.rows).toEqual([
      { status: "SKIPPED", lastError: "插件已停用" },
    ]);
  });

  it("已入队消息固定使用事件发生时的模板快照", async () => {
    await enablePlugin();
    const created = await createRequest(customer, projectId, {
      categoryId,
      title: `钉钉模板快照测试 ${randomUUID()}`,
      description: "<p>模板快照</p>",
      priority: "NORMAL",
    });
    requestIds.push(created.id);
    const delivery = await pool.query<{ id: string }>(
      `SELECT id FROM "DingTalkRobotDelivery" WHERE "requestId" = $1`,
      [created.id],
    );
    const deliveryId = delivery.rows[0]?.id;
    expect(deliveryId).toBeTruthy();

    const changedConfig = structuredClone(DINGTALK_ROBOT_DEFAULT_CONFIG);
    changedConfig.templates.REQUEST_CREATED.title = "修改后的模板";
    await pool.query(
      `UPDATE "PluginInstallation" SET config = $2::jsonb WHERE key = $1`,
      [DINGTALK_ROBOT_PLUGIN_KEY, JSON.stringify(changedConfig)],
    );

    let deliveredTitle = "";
    await processDingTalkRobotDelivery(deliveryId!, {
      finalAttempt: false,
      send: async (_binding, _event, options) => {
        deliveredTitle = options?.template?.title ?? "";
        return { delivered: true };
      },
    });
    expect(deliveredTitle).toBe(
      DINGTALK_ROBOT_DEFAULT_CONFIG.templates.REQUEST_CREATED.title,
    );
  });

  it("关闭钉钉业务规则后不写入新 Outbox", async () => {
    await enablePlugin();
    await pool.query(
      `
        UPDATE "NotificationDeliveryRule"
        SET "dingtalkEnabled" = false, "updatedAt" = NOW()
        WHERE key = 'REQUEST_CREATED'
      `,
    );
    const created = await createRequest(customer, projectId, {
      categoryId,
      title: `钉钉规则关闭测试 ${randomUUID()}`,
      description: "<p>不应发送钉钉消息</p>",
      priority: "NORMAL",
    });
    requestIds.push(created.id);

    const result = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM "DingTalkRobotDelivery" WHERE "requestId" = $1`,
      [created.id],
    );
    expect(result.rows[0]?.count).toBe("0");
  });

  it("关闭钉钉业务规则会终止已经声明但尚未发送的投递", async () => {
    await enablePlugin();
    const created = await createRequest(customer, projectId, {
      categoryId,
      title: `钉钉规则并发关闭测试 ${randomUUID()}`,
      description: "<p>不应继续发送</p>",
      priority: "NORMAL",
    });
    requestIds.push(created.id);
    const delivery = await pool.query<{ id: string }>(
      `SELECT id FROM "DingTalkRobotDelivery" WHERE "requestId" = $1`,
      [created.id],
    );
    const deliveryId = delivery.rows[0]?.id;
    expect(deliveryId).toBeTruthy();

    await pool.query(
      `UPDATE "DingTalkRobotDelivery" SET status = 'PROCESSING' WHERE id = $1`,
      [deliveryId],
    );
    await updateNotificationDeliveryRules(admin, {
      rules: [
        {
          key: "REQUEST_CREATED",
          notificationEnabled: true,
          soundEnabled: true,
          emailEnabled: true,
          dingtalkEnabled: false,
          wechatEnabled: false,
        },
      ],
    });

    const result = await pool.query<{ status: string; lastError: string }>(
      `SELECT status, "lastError" FROM "DingTalkRobotDelivery" WHERE id = $1`,
      [deliveryId],
    );
    expect(result.rows[0]).toEqual({
      status: "SKIPPED",
      lastError: "钉钉通知规则已关闭",
    });
  });

  it("Worker 发送前会再次检查钉钉业务规则", async () => {
    await enablePlugin();
    const created = await createRequest(customer, projectId, {
      categoryId,
      title: `钉钉发送前规则检查 ${randomUUID()}`,
      description: "<p>规则关闭后不应发送</p>",
      priority: "NORMAL",
    });
    requestIds.push(created.id);
    const delivery = await pool.query<{ id: string }>(
      `SELECT id FROM "DingTalkRobotDelivery" WHERE "requestId" = $1`,
      [created.id],
    );
    await pool.query(
      `UPDATE "NotificationDeliveryRule" SET "dingtalkEnabled" = false WHERE key = 'REQUEST_CREATED'`,
    );
    let sent = false;
    const result = await processDingTalkRobotDelivery(delivery.rows[0]!.id, {
      finalAttempt: false,
      send: async () => {
        sent = true;
        return { delivered: true };
      },
    });
    expect(sent).toBe(false);
    expect(result).toMatchObject({ skipped: true });
  });

  it("停用后旧 Worker 不能覆盖 SKIPPED 终态", async () => {
    await enablePlugin();
    const created = await createRequest(customer, projectId, {
      categoryId,
      title: `钉钉并发停用测试 ${randomUUID()}`,
      description: "<p>并发停用消息</p>",
      priority: "NORMAL",
    });
    requestIds.push(created.id);
    const delivery = await pool.query<{ id: string }>(
      `SELECT id FROM "DingTalkRobotDelivery" WHERE "requestId" = $1`,
      [created.id],
    );
    const deliveryId = delivery.rows[0]?.id;
    expect(deliveryId).toBeTruthy();

    const sendStarted = Promise.withResolvers<void>();
    const releaseSend = Promise.withResolvers<void>();
    const processing = processDingTalkRobotDelivery(deliveryId!, {
      finalAttempt: false,
      send: async () => {
        sendStarted.resolve();
        await releaseSend.promise;
        return { delivered: true };
      },
    });
    await sendStarted.promise;
    await withSystemDb(async (tx) => {
      await tx.pluginInstallation.update({
        where: { key: DINGTALK_ROBOT_PLUGIN_KEY },
        data: { enabled: false },
      });
      await applyPluginDisableSideEffects(tx, DINGTALK_ROBOT_PLUGIN_KEY);
    });
    releaseSend.resolve();
    await processing;

    const result = await pool.query<{ status: string }>(
      `SELECT status FROM "DingTalkRobotDelivery" WHERE id = $1`,
      [deliveryId],
    );
    expect(result.rows[0]?.status).toBe("SKIPPED");
  });
});

async function enablePlugin() {
  const secrets = {
    webhookUrl:
      "https://oapi.dingtalk.com/robot/send?access_token=integration-test",
  };
  await pool.query(
    `
      UPDATE "PluginInstallation"
      SET
        enabled = true,
        "healthStatus" = 'READY',
        "secretConfigEncrypted" = $2,
        "healthConfigFingerprint" = $3,
        config = $4::jsonb,
        "updatedAt" = NOW()
      WHERE key = $1
    `,
    [
      DINGTALK_ROBOT_PLUGIN_KEY,
      encryptPluginSecretConfig(secrets),
      fingerprintPluginConfiguration({}, secrets),
      JSON.stringify(DINGTALK_ROBOT_DEFAULT_CONFIG),
    ],
  );
  await pool.query(
    `
      INSERT INTO "NotificationDeliveryRule" (
        key,
        "notificationEnabled",
        "soundEnabled",
        "emailEnabled",
        "dingtalkEnabled",
        "updatedAt"
      ) VALUES
        ('REQUEST_CREATED', true, true, true, true, NOW()),
        ('REQUEST_PUBLIC_MESSAGE', true, true, true, true, NOW())
      ON CONFLICT (key) DO UPDATE
      SET "dingtalkEnabled" = true, "updatedAt" = NOW()
    `,
  );
}
