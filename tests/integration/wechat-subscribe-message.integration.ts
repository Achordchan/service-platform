import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Pool } from "pg";
import type { Actor } from "@/lib/actor";
import { createCustomerSpace } from "@/modules/customer-spaces/customer-space-service";
import { acceptInvitation } from "@/modules/invitations/invitation-service";
import { createProject } from "@/modules/projects/project-service";
import {
  createRequest,
} from "@/modules/requests/request-service";
import { addRequestMessage } from "@/modules/requests/request-command-service";
import {
  createMiniappSessionForCode,
} from "@/modules/miniapp/wechat-binding-service";
import {
  reportSubscribeGrant,
  templateKeyForNotificationType,
} from "@/modules/miniapp/wechat-subscribe-message-service";
import {
  processWechatSubscribeMessageDelivery,
} from "@/modules/miniapp/wechat-subscribe-worker";
import type { WechatSubscribeSender } from "@/modules/miniapp/wechat-api-client";

vi.mock("@/lib/jobs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/jobs")>();
  return {
    ...actual,
    assertMailDeliveryReady: vi.fn().mockResolvedValue("RESEND"),
    dispatchQueuedMailMessage: vi.fn().mockResolvedValue("test-job"),
  };
});

const ownerPool = new Pool({
  connectionString: process.env.DATABASE_MIGRATION_URL,
  max: 1,
});
const run = randomUUID().slice(0, 8);
const emails = [`sub-owner-${run}@local.test`];
const spaceIds: string[] = [];
const projectIds: string[] = [];

let admin: Actor;
let ownerA: Actor;
let ownerAUserId = "";
let wechatRuleOriginally: boolean | null = null;

beforeAll(async () => {
  const adminRow = (
    await ownerPool.query<{
      id: string;
      name: string;
      email: string;
      platformRole: Actor["platformRole"];
    }>(
      'SELECT id, name, email, "platformRole" FROM "User" WHERE email = \'admin@local.test\' LIMIT 1',
    )
  ).rows[0];
  if (!adminRow) {
    throw new Error("请先执行 pnpm test:integration:prepare 创建管理员测试账号");
  }
  admin = { ...adminRow, isPlatformAdmin: true, isStaff: true };

  const ruleRow = await ownerPool.query<{ enabled: boolean | null }>(
    'SELECT "wechatEnabled" AS enabled FROM "NotificationDeliveryRule" WHERE key = \'REQUEST_PUBLIC_MESSAGE\'',
  );
  wechatRuleOriginally = ruleRow.rows[0]?.enabled ?? null;

  const email = emails[0]!;
  const space = await createCustomerSpace(admin, {
    name: "订阅消息集成测试",
    slug: `sub-${run}`,
    ownerName: "订阅测试负责人",
    ownerEmail: email,
    memberLimit: 2,
    status: "ACTIVE",
  });
  spaceIds.push(space.id);
  const outbox = await ownerPool.query<{ action_url: string }>(
    `SELECT "actionUrl" AS action_url FROM "MailMessage"
     WHERE "sourceType" = 'CUSTOMER_OWNER_INVITATION' AND "toEmail" = $1
     ORDER BY "createdAt" DESC LIMIT 1`,
    [email],
  );
  await acceptInvitation({
    token: new URL(outbox.rows[0]!.action_url).searchParams.get("token")!,
    name: "订阅测试负责人",
    password: `sub-pass-${run}-123`,
  });
  const userId = (
    await ownerPool.query<{ id: string }>(
      'SELECT id FROM "User" WHERE email = $1',
      [email],
    )
  ).rows[0]!.id;
  ownerAUserId = userId;
  ownerA = {
    id: userId,
    name: "订阅测试负责人",
    email,
    platformRole: "CUSTOMER",
    isPlatformAdmin: false,
    isStaff: false,
  };

  const seo = (
    await ownerPool.query<{ id: string; category_id: string }>(
      `SELECT st.id, c.id AS category_id
       FROM "ServiceType" st
       JOIN "RequestCategory" c ON c."serviceTypeId" = st.id AND c.active = true
       WHERE st.key = 'seo' LIMIT 1`,
    )
  ).rows[0]!;
  const project = await createProject(admin, {
    title: `订阅消息项目 ${run}`,
    customerSpaceId: space.id,
    serviceTypeId: seo.id,
    customerRequestsEnabled: true,
  });
  await ownerPool.query("UPDATE \"Project\" SET status = 'ACTIVE' WHERE id = $1", [
    project.id,
  ]);
  projectIds.push(project.id);
  fixtureRefs.categoryId = seo.category_id;

  // 客户绑定微信（fake provider）
  const login = await createMiniappSessionForCode(
    { code: "any" },
    { code2Session: async () => ({ openid: `sub-openid-${run}` }) },
  );
  expect(login.status).toBe("NEED_BINDING");
  if (login.status !== "NEED_BINDING") return;
  const membershipId = (
    await ownerPool.query<{ id: string }>(
      'SELECT id FROM "Membership" WHERE "customerSpaceId" = $1 AND "userId" = $2 LIMIT 1',
      [space.id, ownerAUserId],
    )
  ).rows[0]!.id;
  const { code } = await (
    await import("@/modules/miniapp/binding-code-service")
  ).createWechatBindingCode(admin, space.id, membershipId);
  await (
    await import("@/modules/miniapp/wechat-binding-service")
  ).bindTicketToCode({ bindingTicket: login.bindingTicket, code });
});

const fixtureRefs = {} as Record<string, string | undefined>;

afterAll(async () => {
  if (wechatRuleOriginally === null) {
    await ownerPool.query(
      'DELETE FROM "NotificationDeliveryRule" WHERE key = \'REQUEST_PUBLIC_MESSAGE\'',
    );
  } else {
    await ownerPool.query(
      "UPDATE \"NotificationDeliveryRule\" SET \"wechatEnabled\" = $1 WHERE key = 'REQUEST_PUBLIC_MESSAGE'",
      [wechatRuleOriginally],
    );
  }
  await ownerPool.query('DELETE FROM "Project" WHERE id = ANY($1::text[])', [
    projectIds,
  ]);
  await ownerPool.query('DELETE FROM "CustomerSpace" WHERE id = ANY($1::text[])', [
    spaceIds,
  ]);
  await ownerPool.query('DELETE FROM "User" WHERE email = ANY($1::text[])', [
    emails,
  ]);
  await ownerPool.query('DELETE FROM "MailMessage" WHERE "toEmail" = ANY($1::text[])', [
    emails,
  ]);
  await ownerPool.end();
});

async function setWechatRule(enabled: boolean) {
  // 规则行可能不存在（服务端以内存默认兜底），用 upsert 保证落库
  await ownerPool.query(
    `INSERT INTO "NotificationDeliveryRule" (key, "wechatEnabled", "updatedAt")
     VALUES ('REQUEST_PUBLIC_MESSAGE', $1, NOW())
     ON CONFLICT (key) DO UPDATE SET "wechatEnabled" = $1, "updatedAt" = NOW()`,
    [enabled],
  );
}

const senderSent: WechatSubscribeSender = async () => ({ outcome: "SENT" });
const senderNotSubscribed: WechatSubscribeSender = async () => ({
  outcome: "USER_NOT_SUBSCRIBED",
});
// 捕获 sender 入参，断言字段布局与公众平台所选模板一致
const sentInputs: Array<{ templateId?: string; data?: Record<string, string> }> = [];
const senderSentCapture: WechatSubscribeSender = async (input) => {
  sentInputs.push({ templateId: input.templateId, data: input.data });
  return { outcome: "SENT" };
};

describe("微信订阅消息投递", () => {
  it("通知类型映射仅覆盖三类客户提醒模板", () => {
    expect(templateKeyForNotificationType("REQUEST_MESSAGE")).toBe(
      "REQUEST_REPLY",
    );
    expect(templateKeyForNotificationType("REQUEST_STATUS")).toBe(
      "REQUEST_STATUS",
    );
    expect(templateKeyForNotificationType("PROJECT_UPDATE")).toBe(
      "PROJECT_UPDATE",
    );
    expect(templateKeyForNotificationType("REQUEST_ASSIGNED")).toBeNull();
    expect(templateKeyForNotificationType("INVITATION")).toBeNull();
  });

  it("规则关闭时不入队；开启且已绑定+有额度时随通知入队", async () => {
    await setWechatRule(false);
    await reportSubscribeGrant(ownerAUserId, "REQUEST_REPLY");
    const created = await createRequest(ownerA, projectIds[0]!, {
      title: "订阅消息测试工单",
      description: "<p>触发通知链路。</p>",
      categoryId: fixtureRefs.categoryId!,
      priority: "NORMAL",
    });
    // 客户创建工单 → 通知客户自己（REQUEST_CREATED 不在模板范围）
    const noDelivery = await ownerPool.query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM "WechatSubscribeMessageDelivery" WHERE "userId" = $1',
      [ownerAUserId],
    );
    expect(noDelivery.rows[0]?.count).toBe("0");

    // 开启规则 + 员工回复 → 客户收到 REQUEST_MESSAGE 通知 → 入队订阅消息
    await setWechatRule(true);
    await addRequestMessage(admin, created.id, {
      body: "<p>员工公开回复，触发客户通知。</p>",
      visibility: "CUSTOMER_VISIBLE",
    });
    const queued = await ownerPool.query<{
      id: string;
      template_key: string;
      status: string;
    }>(
      'SELECT id, "templateKey" AS template_key, status FROM "WechatSubscribeMessageDelivery" WHERE "userId" = $1 ORDER BY "createdAt" DESC LIMIT 1',
      [ownerAUserId],
    );
    expect(queued.rows[0]?.template_key).toBe("REQUEST_REPLY");
    expect(queued.rows[0]?.status).toBe("PENDING");
    fixtureRefs.deliveryId = queued.rows[0]!.id;
  });

  it("发送成功置 DELIVERED 并扣减额度；43101 清零额度并 SKIPPED", async () => {
    const deliveryId = fixtureRefs.deliveryId!;
    await reportSubscribeGrant(ownerAUserId, "REQUEST_REPLY");

    await processWechatSubscribeMessageDelivery(deliveryId, {
      send: senderSentCapture,
    });
    // 字段布局必须匹配「服务工单通知」模板：工单标题 thing2 + 工单内容 thing3
    //（公众平台选用关键词后微信分配的序号，2026-08 经 newtmpl/gettemplate 核对）
    expect(sentInputs.at(-1)?.data).toMatchObject({
      thing2: expect.any(String),
      thing3: expect.any(String),
    });
    expect(sentInputs.at(-1)?.data).not.toHaveProperty("thing1");
    const delivered = await ownerPool.query<{
      status: string;
      delivered_at: Date | null;
    }>(
      'SELECT status, "deliveredAt" AS delivered_at FROM "WechatSubscribeMessageDelivery" WHERE id = $1',
      [deliveryId],
    );
    expect(delivered.rows[0]?.status).toBe("DELIVERED");

    // 额度耗尽后不再入队
    await ownerPool.query(
      'UPDATE "WechatSubscribeGrant" SET remaining = 0 WHERE "userId" = $1',
      [ownerAUserId],
    );
    const created2 = await createRequest(ownerA, projectIds[0]!, {
      title: "额度耗尽测试",
      description: "<p>无额度不应入队。</p>",
      categoryId: fixtureRefs.categoryId!,
      priority: "NORMAL",
    });
    await addRequestMessage(admin, created2.id, {
      body: "<p>客户无额度。</p>",
      visibility: "CUSTOMER_VISIBLE",
    });
    // 只数「新入队」的行：新 delivery 落库即 PENDING；本用例前序 it 已为同一
    // 用户建过一条、现已 DELIVERED 的记录，若不按状态过滤会被 5 秒窗口一起数进来
    const afterNoGrant = await ownerPool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM "WechatSubscribeMessageDelivery"
       WHERE "userId" = $1 AND status = 'PENDING'
         AND "createdAt" > NOW() - INTERVAL '5 seconds'`,
      [ownerAUserId],
    );
    expect(afterNoGrant.rows[0]?.count).toBe("0");

    // 额度恢复 → 入队 → 43101 → SKIPPED + 清零
    await ownerPool.query(
      'UPDATE "WechatSubscribeGrant" SET remaining = 2 WHERE "userId" = $1',
      [ownerAUserId],
    );
    const created3 = await createRequest(ownerA, projectIds[0]!, {
      title: "未订阅测试",
      description: "<p>43101 场景。</p>",
      categoryId: fixtureRefs.categoryId!,
      priority: "NORMAL",
    });
    await addRequestMessage(admin, created3.id, {
      body: "<p>模拟未订阅。</p>",
      visibility: "CUSTOMER_VISIBLE",
    });
    const queued3 = await ownerPool.query<{ id: string }>(
      'SELECT id FROM "WechatSubscribeMessageDelivery" WHERE "userId" = $1 ORDER BY "createdAt" DESC LIMIT 1',
      [ownerAUserId],
    );
    expect(queued3.rows[0]).toBeTruthy();
    await processWechatSubscribeMessageDelivery(queued3.rows[0]!.id, {
      send: senderNotSubscribed,
    });
    const skipped = await ownerPool.query<{ status: string }>(
      'SELECT status FROM "WechatSubscribeMessageDelivery" WHERE id = $1',
      [queued3.rows[0]!.id],
    );
    expect(skipped.rows[0]?.status).toBe("SKIPPED");
    const grant = await ownerPool.query<{ remaining: number }>(
      'SELECT remaining FROM "WechatSubscribeGrant" WHERE "userId" = $1 AND "templateKey" = \'REQUEST_REPLY\'',
      [ownerAUserId],
    );
    expect(grant.rows[0]?.remaining).toBe(0);
  });

  it("grants 上报 60 秒内节流，不重复累计", async () => {
    const first = await reportSubscribeGrant(ownerAUserId, "REQUEST_STATUS");
    const second = await reportSubscribeGrant(ownerAUserId, "REQUEST_STATUS");
    expect(second.remaining).toBe(first.remaining);
  });

  it("卡在 PROCESSING 超过 15 分钟的投递会被重新捞起（僵尸回收）", async () => {
    await setWechatRule(true);
    await ownerPool.query(
      "UPDATE \"WechatSubscribeGrant\" SET remaining = 3 WHERE \"userId\" = $1 AND \"templateKey\" = 'REQUEST_REPLY'",
      [ownerAUserId],
    );
    const created = await createRequest(ownerA, projectIds[0]!, {
      title: "僵尸回收测试",
      description: "<p>PROCESSING 超时应被重新投递。</p>",
      categoryId: fixtureRefs.categoryId!,
      priority: "NORMAL",
    });
    await addRequestMessage(admin, created.id, {
      body: "<p>触发投递后模拟 worker 崩溃。</p>",
      visibility: "CUSTOMER_VISIBLE",
    });
    const queued = await ownerPool.query<{ id: string }>(
      "SELECT id FROM \"WechatSubscribeMessageDelivery\" WHERE \"userId\" = $1 ORDER BY \"createdAt\" DESC LIMIT 1",
      [ownerAUserId],
    );
    const deliveryId = queued.rows[0]!.id;
    // 模拟 claim 后进程崩溃：卡在 PROCESSING 且 lastAttemptAt 早于 15 分钟
    await ownerPool.query(
      `UPDATE \"WechatSubscribeMessageDelivery\"
       SET status = 'PROCESSING', \"lastAttemptAt\" = (NOW() AT TIME ZONE 'utc') - INTERVAL '20 minutes', \"attemptCount\" = 1
       WHERE id = $1`,
      [deliveryId],
    );

    const { listDueWechatSubscribeDeliveries } = await import(
      "@/modules/miniapp/wechat-subscribe-worker"
    );
    const due = await listDueWechatSubscribeDeliveries();
    expect(due.some((item) => item.id === deliveryId)).toBe(true);

    await processWechatSubscribeMessageDelivery(deliveryId, {
      send: senderSent,
    });
    const recovered = await ownerPool.query<{ status: string }>(
      "SELECT status FROM \"WechatSubscribeMessageDelivery\" WHERE id = $1",
      [deliveryId],
    );
    expect(recovered.rows[0]?.status).toBe("DELIVERED");
  });
});
