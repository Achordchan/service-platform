import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Client, Pool } from "pg";
import type { Actor } from "@/lib/actor";
import { withActorDb } from "@/lib/actor";
import { dispatchQueuedMailMessage } from "@/lib/jobs";
import { processMailMessage } from "@/lib/mail";
import { createInvitation } from "@/modules/customer-spaces/customer-member-service";
import { createDueNotificationMailMessages } from "@/modules/notifications/notification-email-service";
import {
  createNotification,
  dispatchRequestActivity,
  getNotificationSummary,
  listNotifications,
  markNotificationRead,
} from "@/modules/notifications/notification-service";
import { updateNotificationPreferences } from "@/modules/users/notification-preference-service";
import { createRequest } from "@/modules/requests/request-service";

vi.mock("@/lib/jobs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/jobs")>();
  return {
    ...actual,
    dispatchQueuedMailMessage: vi.fn().mockResolvedValue("test-mail-job"),
  };
});

const pool = new Pool({
  connectionString: process.env.DATABASE_MIGRATION_URL,
  max: 1,
});

const cleanup = {
  invitationIds: [] as string[],
  notificationIds: [] as string[],
  summaryNotificationIds: [] as string[],
  eventMarkers: [] as string[],
  requestIds: [] as string[],
};

let admin: Actor;
let customer: Actor;
let customerSpaceId = "";
let originalMemberLimit = 0;
let projectId = "";
let requestId = "";
let categoryId = "";
let originalMailMode = "LOCAL_OUTBOX";
let originalStandardMailEnabled = false;
let originalUserMailEnabled = true;
let originalAdminMailEnabled = true;
let originalProjectUpdateRule: {
  notificationEnabled: boolean;
  soundEnabled: boolean;
  emailEnabled: boolean;
} | null = null;
let originalRequestPublicMessageRule: {
  notificationEnabled: boolean;
  soundEnabled: boolean;
  emailEnabled: boolean;
} | null = null;
let originalRequestCreatedRule: {
  notificationEnabled: boolean;
  soundEnabled: boolean;
  emailEnabled: boolean;
} | null = null;

beforeAll(async () => {
  const result = await pool.query<{
    admin_id: string;
    admin_name: string;
    admin_email: string;
    customer_id: string;
    customer_name: string;
    customer_email: string;
    customer_space_id: string;
    member_limit: number;
    project_id: string;
    request_id: string;
    category_id: string;
  }>(
    `
      SELECT
        admin.id AS admin_id,
        admin.name AS admin_name,
        admin.email AS admin_email,
        customer.id AS customer_id,
        customer.name AS customer_name,
        customer.email AS customer_email,
        project."customerSpaceId" AS customer_space_id,
        customer_space."memberLimit" AS member_limit,
        project.id AS project_id,
        request.id AS request_id,
        request."categoryId" AS category_id
      FROM "User" admin
      JOIN "User" customer ON customer.email = 'client@local.test'
      JOIN "Membership" membership
        ON membership."userId" = customer.id
       AND membership.role = 'OWNER'
      JOIN "Project" project
        ON project."customerSpaceId" = membership."customerSpaceId"
       AND project.kind = 'STANDARD'
      JOIN "CustomerSpace" customer_space
        ON customer_space.id = project."customerSpaceId"
      JOIN "ServiceRequest" request ON request."projectId" = project.id
      WHERE admin.email = 'admin@local.test'
      LIMIT 1
    `,
  );
  const row = result.rows[0];
  if (!row) {
    throw new Error("请先执行 pnpm test:integration:prepare 准备 *_test 库与种子数据");
  }
  admin = actor(
    row.admin_id,
    row.admin_name,
    row.admin_email,
    "PLATFORM_ADMIN",
  );
  customer = actor(
    row.customer_id,
    row.customer_name,
    row.customer_email,
    "CUSTOMER",
  );
  customerSpaceId = row.customer_space_id;
  originalMemberLimit = row.member_limit;
  projectId = row.project_id;
  requestId = row.request_id;
  categoryId = row.category_id;

  const settings = await pool.query<{
    mail_mode: string;
    standard_enabled: boolean;
  }>(
    `SELECT "mailMode"::text AS mail_mode,
            "standardRequestEmailEnabled" AS standard_enabled
       FROM "PlatformSetting" WHERE id = 1`,
  );
  originalMailMode = settings.rows[0]?.mail_mode ?? "LOCAL_OUTBOX";
  originalStandardMailEnabled = settings.rows[0]?.standard_enabled ?? false;
  const preference = await pool.query<{ enabled: boolean }>(
    `SELECT "requestEmailNotificationsEnabled" AS enabled
       FROM "User" WHERE id = $1`,
    [customer.id],
  );
  originalUserMailEnabled = preference.rows[0]?.enabled ?? true;
  const adminPreference = await pool.query<{ enabled: boolean }>(
    `SELECT "requestEmailNotificationsEnabled" AS enabled
       FROM "User" WHERE id = $1`,
    [admin.id],
  );
  originalAdminMailEnabled = adminPreference.rows[0]?.enabled ?? true;
  const projectRule = await pool.query<{
    notification_enabled: boolean;
    sound_enabled: boolean;
    email_enabled: boolean;
  }>(
    `SELECT "notificationEnabled" AS notification_enabled,
            "soundEnabled" AS sound_enabled,
            "emailEnabled" AS email_enabled
       FROM "NotificationDeliveryRule"
      WHERE key = 'PROJECT_UPDATE'`,
  );
  originalProjectUpdateRule = projectRule.rows[0]
    ? {
        notificationEnabled: projectRule.rows[0].notification_enabled,
        soundEnabled: projectRule.rows[0].sound_enabled,
        emailEnabled: projectRule.rows[0].email_enabled,
      }
    : null;
  const requestPublicMessageRule = await pool.query<{
    notification_enabled: boolean;
    sound_enabled: boolean;
    email_enabled: boolean;
  }>(
    `SELECT "notificationEnabled" AS notification_enabled,
            "soundEnabled" AS sound_enabled,
            "emailEnabled" AS email_enabled
       FROM "NotificationDeliveryRule"
      WHERE key = 'REQUEST_PUBLIC_MESSAGE'`,
  );
  originalRequestPublicMessageRule = requestPublicMessageRule.rows[0]
    ? {
        notificationEnabled:
          requestPublicMessageRule.rows[0].notification_enabled,
        soundEnabled: requestPublicMessageRule.rows[0].sound_enabled,
        emailEnabled: requestPublicMessageRule.rows[0].email_enabled,
      }
    : null;
  const requestCreatedRule = await pool.query<{
    notification_enabled: boolean;
    sound_enabled: boolean;
    email_enabled: boolean;
  }>(
    `SELECT "notificationEnabled" AS notification_enabled,
            "soundEnabled" AS sound_enabled,
            "emailEnabled" AS email_enabled
       FROM "NotificationDeliveryRule"
      WHERE key = 'REQUEST_CREATED'`,
  );
  originalRequestCreatedRule = requestCreatedRule.rows[0]
    ? {
        notificationEnabled: requestCreatedRule.rows[0].notification_enabled,
        soundEnabled: requestCreatedRule.rows[0].sound_enabled,
        emailEnabled: requestCreatedRule.rows[0].email_enabled,
      }
    : null;
});

afterAll(async () => {
  const allNotificationIds = [
    ...cleanup.notificationIds,
    ...cleanup.summaryNotificationIds,
  ];
  if (allNotificationIds.length > 0) {
    await pool.query(
      `DELETE FROM "MailMessage" WHERE "notificationId" = ANY($1::text[])`,
      [allNotificationIds],
    );
    await pool.query(
      `DELETE FROM "EventRecord"
       WHERE payload->>'notificationId' = ANY($1::text[])`,
      [allNotificationIds],
    );
    await pool.query(
      `DELETE FROM "Notification" WHERE id = ANY($1::text[])`,
      [allNotificationIds],
    );
  }
  if (cleanup.invitationIds.length > 0) {
    await pool.query(
      `DELETE FROM "MailMessage"
       WHERE "sourceType" = 'CUSTOMER_MEMBER_INVITATION'
         AND "sourceId" = ANY($1::text[])`,
      [cleanup.invitationIds],
    );
    await pool.query(
      `DELETE FROM "Invitation" WHERE id = ANY($1::text[])`,
      [cleanup.invitationIds],
    );
  }
  if (cleanup.eventMarkers.length > 0) {
    await pool.query(
      `DELETE FROM "EventRecord"
       WHERE payload->>'integrationMarker' = ANY($1::text[])`,
      [cleanup.eventMarkers],
    );
  }
  if (cleanup.requestIds.length > 0) {
    await pool.query(
      `DELETE FROM "AuditLog"
       WHERE "serviceRequestId" = ANY($1::text[])
          OR "resourceId" = ANY($1::text[])`,
      [cleanup.requestIds],
    );
    await pool.query(
      `DELETE FROM "ServiceRequest" WHERE id = ANY($1::text[])`,
      [cleanup.requestIds],
    );
  }
  await pool.query(
    `UPDATE "PlatformSetting"
     SET "mailMode" = $1::"MailDeliveryMode",
         "standardRequestEmailEnabled" = $2,
         "updatedAt" = NOW()
     WHERE id = 1`,
    [originalMailMode, originalStandardMailEnabled],
  );
  await pool.query(
    `UPDATE "CustomerSpace" SET "memberLimit" = $1 WHERE id = $2`,
    [originalMemberLimit, customerSpaceId],
  );
  await pool.query(
    `UPDATE "User"
     SET "requestEmailNotificationsEnabled" = $1,
         "updatedAt" = NOW()
     WHERE id = $2`,
    [originalUserMailEnabled, customer.id],
  );
  await pool.query(
    `UPDATE "User"
     SET "requestEmailNotificationsEnabled" = $1,
         "updatedAt" = NOW()
     WHERE id = $2`,
    [originalAdminMailEnabled, admin.id],
  );
  if (originalProjectUpdateRule) {
    await pool.query(
      `INSERT INTO "NotificationDeliveryRule" (
         key, "notificationEnabled", "soundEnabled", "emailEnabled", "updatedAt"
       ) VALUES ('PROJECT_UPDATE', $1, $2, $3, NOW())
       ON CONFLICT (key) DO UPDATE SET
         "notificationEnabled" = EXCLUDED."notificationEnabled",
         "soundEnabled" = EXCLUDED."soundEnabled",
         "emailEnabled" = EXCLUDED."emailEnabled",
         "updatedAt" = NOW()`,
      [
        originalProjectUpdateRule.notificationEnabled,
        originalProjectUpdateRule.soundEnabled,
        originalProjectUpdateRule.emailEnabled,
      ],
    );
  } else {
    await pool.query(
      `DELETE FROM "NotificationDeliveryRule" WHERE key = 'PROJECT_UPDATE'`,
    );
  }
  if (originalRequestPublicMessageRule) {
    await pool.query(
      `INSERT INTO "NotificationDeliveryRule" (
         key, "notificationEnabled", "soundEnabled", "emailEnabled", "updatedAt"
       ) VALUES ('REQUEST_PUBLIC_MESSAGE', $1, $2, $3, NOW())
       ON CONFLICT (key) DO UPDATE SET
         "notificationEnabled" = EXCLUDED."notificationEnabled",
         "soundEnabled" = EXCLUDED."soundEnabled",
         "emailEnabled" = EXCLUDED."emailEnabled",
         "updatedAt" = NOW()`,
      [
        originalRequestPublicMessageRule.notificationEnabled,
        originalRequestPublicMessageRule.soundEnabled,
        originalRequestPublicMessageRule.emailEnabled,
      ],
    );
  } else {
    await pool.query(
      `DELETE FROM "NotificationDeliveryRule"
       WHERE key = 'REQUEST_PUBLIC_MESSAGE'`,
    );
  }
  if (originalRequestCreatedRule) {
    await pool.query(
      `INSERT INTO "NotificationDeliveryRule" (
         key, "notificationEnabled", "soundEnabled", "emailEnabled", "updatedAt"
       ) VALUES ('REQUEST_CREATED', $1, $2, $3, NOW())
       ON CONFLICT (key) DO UPDATE SET
         "notificationEnabled" = EXCLUDED."notificationEnabled",
         "soundEnabled" = EXCLUDED."soundEnabled",
         "emailEnabled" = EXCLUDED."emailEnabled",
         "updatedAt" = NOW()`,
      [
        originalRequestCreatedRule.notificationEnabled,
        originalRequestCreatedRule.soundEnabled,
        originalRequestCreatedRule.emailEnabled,
      ],
    );
  } else {
    await pool.query(
      `DELETE FROM "NotificationDeliveryRule" WHERE key = 'REQUEST_CREATED'`,
    );
  }
  await pool.end();
});

describe("通知、延迟邮件与 Outbox 集成", () => {
  it("客户 Owner 在 RLS 下创建邀请时，邀请和邮件 Outbox 同时落库", async () => {
    vi.mocked(dispatchQueuedMailMessage).mockClear();
    await pool.query(
      `UPDATE "CustomerSpace" SET "memberLimit" = $1 WHERE id = $2`,
      [originalMemberLimit + 1, customerSpaceId],
    );
    const invitedEmail = `notification-outbox-${randomUUID()}@local.test`;
    const invitation = await createInvitation(customer, customerSpaceId, {
      email: invitedEmail,
    });
    cleanup.invitationIds.push(invitation.id);

    const stored = await pool.query<{
      invitation_count: string;
      mail_count: string;
      source_id: string | null;
      status: string;
      created_at_is_current: boolean;
    }>(
      `
        SELECT
          (SELECT COUNT(*) FROM "Invitation" WHERE id = $1)::text
            AS invitation_count,
          (SELECT COUNT(*) FROM "MailMessage"
             WHERE "sourceType" = 'CUSTOMER_MEMBER_INVITATION'
               AND "sourceId" = $1)::text AS mail_count,
          mail."sourceId" AS source_id,
          mail.status::text,
          mail."createdAt" BETWEEN
            (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') - INTERVAL '1 minute'
            AND
            (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') + INTERVAL '1 minute'
            AS created_at_is_current
        FROM "MailMessage" mail
        WHERE mail."sourceType" = 'CUSTOMER_MEMBER_INVITATION'
          AND mail."sourceId" = $1
        LIMIT 1
      `,
      [invitation.id],
    );
    expect(stored.rows[0]).toEqual({
      invitation_count: "1",
      mail_count: "1",
      source_id: invitation.id,
      status: "QUEUED",
      created_at_is_current: true,
    });
    expect(dispatchQueuedMailMessage).toHaveBeenCalledOnce();
  });

  it("延迟邮件只创建一次，并在用户已读后于发送前取消", async () => {
    await configureStandardMail(true);
    const notificationId = await createDueRequestNotification();
    cleanup.notificationIds.push(notificationId);

    const firstSweep = await createDueNotificationMailMessages();
    const secondSweep = await createDueNotificationMailMessages();
    expect(firstSweep).toHaveLength(1);
    expect(secondSweep).toEqual([]);

    await markNotificationRead(customer, notificationId);
    const immediatelyCancelled = await pool.query<{ status: string }>(
      `SELECT status::text FROM "MailMessage" WHERE id = $1`,
      [firstSweep[0]],
    );
    expect(immediatelyCancelled.rows[0]?.status).toBe("CANCELLED");
    await expect(
      processMailMessage(firstSweep[0]!, { finalAttempt: true }),
    ).resolves.toEqual({ id: firstSweep[0], skipped: true });

    const message = await pool.query<{ status: string }>(
      `SELECT status::text FROM "MailMessage" WHERE id = $1`,
      [firstSweep[0]],
    );
    expect(message.rows[0]?.status).toBe("CANCELLED");
  });

  it("后台公开回复会通过真实活动分发为客户排期延迟邮件", async () => {
    await configureStandardMail(true);
    await setRequestPublicMessageMailRule(true);
    const activePresence = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
         FROM "RequestPresence"
        WHERE "serviceRequestId" = $1
          AND "userId" = $2
          AND "expiresAt" > NOW()`,
      [requestId, customer.id],
    );
    expect(activePresence.rows[0]?.count).toBe("0");

    const integrationMarker = `request-email-${randomUUID()}`;
    cleanup.eventMarkers.push(integrationMarker);
    const delivery = await withActorDb(admin, (tx) =>
      dispatchRequestActivity(tx, admin, {
        eventType: "REQUEST_MESSAGE_CREATED",
        eventPayload: {
          requestId,
          visibility: "CUSTOMER_VISIBLE",
          integrationMarker,
        },
        notificationType: "REQUEST_MESSAGE",
        notificationTitle: "公开回复邮件排期测试",
        notificationBody: "真实活动分发必须写入邮件到期时间",
        includeCustomers: true,
        relevantWorkerUserIds: [],
        notifyProjectManagers: false,
        notifyPlatformAdmins: false,
        customerSpaceId,
        projectId,
        serviceRequestId: requestId,
      }),
    );
    cleanup.notificationIds.push(
      ...delivery.notifications.map((notification) => notification.id),
    );

    const customerNotification = await pool.query<{
      email_due_at: string | null;
      read_at: string | null;
      scheduled_after_four_minutes: boolean;
      scheduled_before_six_minutes: boolean;
    }>(
      `SELECT
          "emailDueAt"::text AS email_due_at,
          "readAt"::text AS read_at,
          "emailDueAt" >
            (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') + INTERVAL '4 minutes'
            AS scheduled_after_four_minutes,
          "emailDueAt" <
            (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') + INTERVAL '6 minutes'
            AS scheduled_before_six_minutes
         FROM "Notification"
        WHERE id = ANY($1::text[])
          AND "userId" = $2
        LIMIT 1`,
      [
        delivery.notifications.map((notification) => notification.id),
        customer.id,
      ],
    );
    const scheduled = customerNotification.rows[0];
    expect(scheduled?.read_at).toBeNull();
    expect(scheduled?.email_due_at).not.toBeNull();
    expect(scheduled?.scheduled_after_four_minutes).toBe(true);
    expect(scheduled?.scheduled_before_six_minutes).toBe(true);
  });

  it("客户新建标准工单会为平台管理员创建并投递邮件 Outbox", async () => {
    await configureStandardMail(true, false);
    await setUserMailPreference(admin.id, true);
    await setRequestCreatedMailRule(true);

    const created = await createRequest(customer, projectId, {
      title: `管理员新工单邮件 ${randomUUID().slice(0, 8)}`,
      description: "<p>验证客户新建工单后平台管理员可以收到邮件。</p>",
      categoryId,
      priority: "NORMAL",
    });
    cleanup.requestIds.push(created.id);

    const notification = await pool.query<{
      id: string;
      email_due_at: Date | null;
    }>(
      `SELECT id, "emailDueAt" AS email_due_at
         FROM "Notification"
        WHERE "serviceRequestId" = $1
          AND "userId" = $2
          AND type = 'REQUEST_CREATED'
          AND "readAt" IS NULL
        LIMIT 1`,
      [created.id, admin.id],
    );
    const adminNotification = notification.rows[0];
    expect(adminNotification?.email_due_at).not.toBeNull();
    cleanup.notificationIds.push(adminNotification!.id);

    const createdMailIds = await createDueNotificationMailMessages();
    const message = await pool.query<{
      to_email: string;
      source_type: string;
      status: string;
    }>(
      `SELECT "toEmail" AS to_email,
              "sourceType" AS source_type,
              status::text
         FROM "MailMessage"
        WHERE "notificationId" = $1
          AND id = ANY($2::text[])
        LIMIT 1`,
      [adminNotification!.id, createdMailIds],
    );
    expect(message.rows[0]).toEqual({
      to_email: admin.email,
      source_type: "STANDARD_REQUEST_NOTIFICATION",
      status: "QUEUED",
    });
  });

  it("关闭未读延迟后，规则开启的新事件立即进入邮件队列", async () => {
    await configureStandardMail(true, false);
    await setRequestPublicMessageMailRule(true);
    const integrationMarker = `request-email-immediate-${randomUUID()}`;
    cleanup.eventMarkers.push(integrationMarker);
    const listener = new Client({
      connectionString: process.env.DATABASE_MIGRATION_URL,
    });
    await listener.connect();
    await listener.query("LISTEN service_platform_mail_outbox");
    let wakeTimer: ReturnType<typeof setTimeout> | undefined;
    const wakePayload = new Promise<string>((resolve, reject) => {
      wakeTimer = setTimeout(
        () => reject(new Error("即时邮件 Outbox 未收到事务提交信号")),
        2_000,
      );
      listener.on("notification", (message) => {
        if (message.channel !== "service_platform_mail_outbox") return;
        if (wakeTimer) clearTimeout(wakeTimer);
        resolve(message.payload ?? "");
      });
    });

    let delivery: Awaited<ReturnType<typeof dispatchRequestActivity>>;
    try {
      delivery = await withActorDb(admin, (tx) =>
        dispatchRequestActivity(tx, admin, {
          eventType: "REQUEST_MESSAGE_CREATED",
          eventPayload: {
            requestId,
            visibility: "CUSTOMER_VISIBLE",
            integrationMarker,
          },
          notificationType: "REQUEST_MESSAGE",
          notificationTitle: "公开回复立即邮件测试",
          notificationBody: "关闭未读延迟后应立即进入到期队列",
          includeCustomers: true,
          relevantWorkerUserIds: [],
          notifyProjectManagers: false,
          notifyPlatformAdmins: false,
          customerSpaceId,
          projectId,
          serviceRequestId: requestId,
        }),
      );
      const payload = await wakePayload;
      expect(
        delivery.notifications.some((notification) => notification.id === payload),
      ).toBe(true);
    } finally {
      if (wakeTimer) clearTimeout(wakeTimer);
      await listener.end();
    }
    cleanup.notificationIds.push(
      ...delivery.notifications.map((notification) => notification.id),
    );

    const customerNotification = delivery.notifications.find(
      (notification) => notification.userId === customer.id,
    );
    expect(customerNotification).toBeTruthy();
    const created = await createDueNotificationMailMessages();
    expect(created.length).toBeGreaterThanOrEqual(1);
    const customerMail = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
         FROM "MailMessage"
        WHERE "notificationId" = $1`,
      [customerNotification!.id],
    );
    expect(customerMail.rows[0]?.count).toBe("1");
  });

  it("个人邮件偏好关闭时，到期通知不会创建业务邮件", async () => {
    await configureStandardMail(false);
    const notificationId = await createDueRequestNotification();
    cleanup.notificationIds.push(notificationId);

    await expect(createDueNotificationMailMessages()).resolves.toEqual([]);
    const state = await pool.query<{
      email_due_at: Date | null;
      mail_count: string;
    }>(
      `
        SELECT
          notification."emailDueAt" AS email_due_at,
          (SELECT COUNT(*) FROM "MailMessage"
             WHERE "notificationId" = notification.id)::text AS mail_count
        FROM "Notification" notification
        WHERE notification.id = $1
      `,
      [notificationId],
    );
    expect(state.rows[0]).toEqual({ email_due_at: null, mail_count: "0" });
  });

  it("个人邮件偏好关闭会永久取消已经生成的待发邮件", async () => {
    await configureStandardMail(true);
    const notificationId = await createDueRequestNotification();
    cleanup.notificationIds.push(notificationId);
    const [mailMessageId] = await createDueNotificationMailMessages();
    expect(mailMessageId).toBeTruthy();

    await updateNotificationPreferences(customer, {
      requestEmailNotificationsEnabled: false,
    });
    const cancelled = await pool.query<{ status: string }>(
      `SELECT status::text FROM "MailMessage" WHERE id = $1`,
      [mailMessageId],
    );
    expect(cancelled.rows[0]?.status).toBe("CANCELLED");

    await updateNotificationPreferences(customer, {
      requestEmailNotificationsEnabled: true,
    });
    await expect(
      processMailMessage(mailMessageId!, { finalAttempt: true }),
    ).resolves.toEqual({ id: mailMessageId, skipped: true });
  });

  it("项目交付邮件只处理规则开启后产生的新通知", async () => {
    await configureStandardMail(true);
    await setProjectUpdateMailRule(false);
    const historicalId = await createProjectNotification();
    cleanup.notificationIds.push(historicalId);

    await setProjectUpdateMailRule(true);
    await expect(createDueNotificationMailMessages()).resolves.toEqual([]);

    const currentId = await createProjectNotification(
      new Date(Date.now() - 60_000),
    );
    cleanup.notificationIds.push(currentId);
    const created = await createDueNotificationMailMessages();
    expect(created).toHaveLength(1);

    const messages = await pool.query<{
      notification_id: string;
      template_key: string;
      source_type: string;
    }>(
      `SELECT "notificationId" AS notification_id,
              "templateKey" AS template_key,
              "sourceType" AS source_type
         FROM "MailMessage"
        WHERE "notificationId" = ANY($1::text[])
        ORDER BY "createdAt" ASC`,
      [[historicalId, currentId]],
    );
    expect(messages.rows).toEqual([
      {
        notification_id: currentId,
        template_key: "STANDARD_PROJECT_CUSTOMER_UPDATE",
        source_type: "STANDARD_PROJECT_NOTIFICATION",
      },
    ]);
    await markNotificationRead(customer, currentId);
    const immediatelyCancelled = await pool.query<{ status: string }>(
      `SELECT status::text FROM "MailMessage" WHERE id = $1`,
      [created[0]],
    );
    expect(immediatelyCancelled.rows[0]?.status).toBe("CANCELLED");
    await expect(
      processMailMessage(created[0]!, { finalAttempt: true }),
    ).resolves.toEqual({ id: created[0], skipped: true });
  });

  it("35 条以上未读仍能完整统计并通过游标无重复读取", async () => {
    await configureStandardMail(true);
    const baseline = await getNotificationSummary(customer);
    const baselineProjectCount =
      baseline.projectDeliveryCounts[projectId] ?? 0;
    for (let index = 0; index < 35; index += 1) {
      const id = randomUUID();
      cleanup.summaryNotificationIds.push(id);
      await pool.query(
        `
          INSERT INTO "Notification" (
            id, type, title, body, "userId", "customerSpaceId",
            "projectId", "createdAt", "updatedAt"
          )
          VALUES (
            $1, 'PROJECT_STAGE', $2, '分页测试', $3, $4, $5, NOW(), NOW()
          )
        `,
        [id, `未读分页 ${index + 1}`, customer.id, customerSpaceId, projectId],
      );
    }

    const summary = await getNotificationSummary(customer);
    expect(summary.totalUnread).toBe(baseline.totalUnread + 35);
    expect(summary.projectDeliveryCounts[projectId]).toBe(
      baselineProjectCount + 35,
    );

    const seen = new Set<string>();
    const fixtureSeen = new Set<string>();
    let cursor: string | undefined;
    for (let pageIndex = 0; pageIndex < 20; pageIndex += 1) {
      const page = await listNotifications(customer, { limit: 30, cursor });
      for (const item of page.items) {
        expect(seen.has(item.id)).toBe(false);
        seen.add(item.id);
        if (cleanup.summaryNotificationIds.includes(item.id)) {
          fixtureSeen.add(item.id);
        }
      }
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
    }
    expect(fixtureSeen.size).toBe(35);
  });
});

async function createDueRequestNotification() {
  return withActorDb(admin, async (tx) => {
    const notification = await createNotification(tx, {
      type: "REQUEST_MESSAGE",
      title: "延迟邮件集成测试",
      body: "这是一条未读回复摘要",
      userId: customer.id,
      customerSpaceId,
      projectId,
      serviceRequestId: requestId,
      aggregationKey: `integration-notification:${randomUUID()}`,
      emailDueAt: new Date(Date.now() - 60_000),
    });
    return notification.id;
  });
}

async function createProjectNotification(emailDueAt?: Date) {
  return withActorDb(admin, async (tx) => {
    const notification = await createNotification(tx, {
      type: "PROJECT_UPDATE",
      title: "项目发布了新的进度",
      body: "首页视觉稿已经完成，请查看最新进展。",
      userId: customer.id,
      customerSpaceId,
      projectId,
      emailDueAt,
    });
    return notification.id;
  });
}

async function setProjectUpdateMailRule(emailEnabled: boolean) {
  await pool.query(
    `INSERT INTO "NotificationDeliveryRule" (
       key, "notificationEnabled", "soundEnabled", "emailEnabled", "updatedAt"
     ) VALUES ('PROJECT_UPDATE', true, true, $1, NOW())
     ON CONFLICT (key) DO UPDATE SET
       "notificationEnabled" = true,
       "soundEnabled" = true,
       "emailEnabled" = EXCLUDED."emailEnabled",
       "updatedAt" = NOW()`,
    [emailEnabled],
  );
}

async function setRequestPublicMessageMailRule(emailEnabled: boolean) {
  await pool.query(
    `INSERT INTO "NotificationDeliveryRule" (
       key, "notificationEnabled", "soundEnabled", "emailEnabled", "updatedAt"
     ) VALUES ('REQUEST_PUBLIC_MESSAGE', true, true, $1, NOW())
     ON CONFLICT (key) DO UPDATE SET
       "notificationEnabled" = true,
       "soundEnabled" = true,
       "emailEnabled" = EXCLUDED."emailEnabled",
       "updatedAt" = NOW()`,
    [emailEnabled],
  );
}

async function setRequestCreatedMailRule(emailEnabled: boolean) {
  await pool.query(
    `INSERT INTO "NotificationDeliveryRule" (
       key, "notificationEnabled", "soundEnabled", "emailEnabled", "updatedAt"
     ) VALUES ('REQUEST_CREATED', true, true, $1, NOW())
     ON CONFLICT (key) DO UPDATE SET
       "notificationEnabled" = true,
       "soundEnabled" = true,
       "emailEnabled" = EXCLUDED."emailEnabled",
       "updatedAt" = NOW()`,
    [emailEnabled],
  );
}

async function setUserMailPreference(userId: string, enabled: boolean) {
  await pool.query(
    `UPDATE "User"
     SET "requestEmailNotificationsEnabled" = $1,
         "updatedAt" = NOW()
     WHERE id = $2`,
    [enabled, userId],
  );
}

async function configureStandardMail(
  userPreference: boolean,
  unreadDelayEnabled = true,
) {
  await pool.query(
    `UPDATE "PlatformSetting"
     SET "mailMode" = 'RESEND',
         "standardRequestEmailEnabled" = $1,
         "updatedAt" = NOW()
     WHERE id = 1`,
    [unreadDelayEnabled],
  );
  await pool.query(
    `UPDATE "User"
     SET "requestEmailNotificationsEnabled" = $1,
         "updatedAt" = NOW()
     WHERE id = $2`,
    [userPreference, customer.id],
  );
}

function actor(
  id: string,
  name: string,
  email: string,
  platformRole: Actor["platformRole"],
): Actor {
  return {
    id,
    name,
    email,
    platformRole,
    isPlatformAdmin: platformRole === "PLATFORM_ADMIN",
    isStaff: platformRole !== "CUSTOMER",
  };
}
