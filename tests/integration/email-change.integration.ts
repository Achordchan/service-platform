import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Pool } from "pg";
import type { Actor } from "@/lib/actor";
import { dispatchQueuedMailMessage } from "@/lib/jobs";
import {
  createInvitationToken,
} from "@/modules/invitations/invitation-token";
import {
  confirmCustomerEmailChange,
  cancelUserEmailChange,
  getEmailChangePreview,
  getPendingUserEmailChange,
  requestUserEmailChange,
} from "@/modules/users/customer-email-change-service";

vi.mock("@/lib/jobs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/jobs")>();
  return {
    ...actual,
    assertMailDeliveryReady: vi.fn().mockResolvedValue("RESEND"),
    dispatchQueuedMailMessage: vi
      .fn()
      .mockResolvedValue("email-change-test-job"),
  };
});

vi.mock("@/modules/platform-settings/mail-provider-lifecycle", () => ({
  resolveLockedMailDeliveryMode: vi.fn().mockResolvedValue("RESEND"),
}));

const pool = new Pool({
  connectionString: process.env.DATABASE_MIGRATION_URL,
  max: 1,
});

const fixture = {
  userId: randomUUID(),
  changeId: randomUUID(),
  sessionId: randomUUID(),
  invitationId: randomUUID(),
  oldEmail: `email-change-old-${randomUUID()}@local.test`,
  newEmail: `email-change-new-${randomUUID()}@local.test`,
};
const token = createInvitationToken();
let adminId = "";
let adminActor: Actor;
let customerSpaceId = "";
const staffFixture = {
  userId: randomUUID(),
  oldEmail: `staff-email-old-${randomUUID()}@local.test`,
  selfEmail: `staff-email-self-${randomUUID()}@local.test`,
  adminEmail: `staff-email-admin-${randomUUID()}@local.test`,
};
const staffActor: Actor = {
  id: staffFixture.userId,
  name: "邮箱变更测试成员",
  email: staffFixture.oldEmail,
  platformRole: "TECHNICIAN",
  isPlatformAdmin: false,
  isStaff: true,
};

beforeAll(async () => {
  const context = await pool.query<{
    admin_id: string;
    admin_name: string;
    admin_email: string;
    customer_space_id: string;
  }>(
    `
      SELECT
        admin.id AS admin_id,
        admin.name AS admin_name,
        admin.email AS admin_email,
        customer_space.id AS customer_space_id
      FROM "User" admin
      CROSS JOIN "CustomerSpace" customer_space
      WHERE admin.email = 'admin@local.test'
      LIMIT 1
    `,
  );
  adminId = context.rows[0]?.admin_id ?? "";
  customerSpaceId = context.rows[0]?.customer_space_id ?? "";
  if (!adminId || !customerSpaceId) {
    throw new Error("请先执行 pnpm test:integration:prepare");
  }
  adminActor = {
    id: adminId,
    name: context.rows[0]?.admin_name ?? "平台管理员",
    email: context.rows[0]?.admin_email ?? "admin@local.test",
    platformRole: "PLATFORM_ADMIN",
    isPlatformAdmin: true,
    isStaff: true,
  };

  await pool.query(
    `
      INSERT INTO "User" (
        id,
        name,
        email,
        "emailVerified",
        "platformRole",
        "updatedAt"
      )
      VALUES ($1, '邮箱变更测试客户', $2, true, 'CUSTOMER', NOW())
    `,
    [fixture.userId, fixture.oldEmail],
  );
  await pool.query(
    `
      INSERT INTO "User" (
        id,
        name,
        email,
        "emailVerified",
        "platformRole",
        "updatedAt"
      )
      VALUES ($1, '邮箱变更测试成员', $2, true, 'TECHNICIAN', NOW())
    `,
    [staffFixture.userId, staffFixture.oldEmail],
  );
  await pool.query(
    `
      INSERT INTO "UserEmailChange" (
        id,
        "userId",
        "oldEmail",
        "newEmail",
        "tokenHash",
        status,
        "expiresAt",
        "lastSentAt",
        "requestedById",
        "updatedAt"
      )
      VALUES (
        $1,
        $2,
        $3,
        $4,
        $5,
        'PENDING',
        NOW() + INTERVAL '24 hours',
        NOW(),
        $6,
        NOW()
      )
    `,
    [
      fixture.changeId,
      fixture.userId,
      fixture.oldEmail,
      fixture.newEmail,
      token.tokenHash,
      adminId,
    ],
  );
  await pool.query(
    `
      INSERT INTO "Session" (
        id,
        "expiresAt",
        token,
        "userId",
        "updatedAt"
      )
      VALUES ($1, NOW() + INTERVAL '1 day', $2, $3, NOW())
    `,
    [fixture.sessionId, randomUUID(), fixture.userId],
  );
  await pool.query(
    `
      INSERT INTO "Invitation" (
        id,
        email,
        "tokenHash",
        "expiresAt",
        "customerSpaceId",
        "invitedById"
      )
      VALUES ($1, $2, $3, NOW() + INTERVAL '1 day', $4, $5)
    `,
    [
      fixture.invitationId,
      fixture.oldEmail,
      randomUUID(),
      customerSpaceId,
      adminId,
    ],
  );
});

afterAll(async () => {
  await pool.query(
    `DELETE FROM "MailMessage"
      WHERE "sourceId" IN (
        SELECT id FROM "UserEmailChange" WHERE "userId" = $1
      )`,
    [staffFixture.userId],
  );
  await pool.query(`DELETE FROM "User" WHERE id = $1`, [staffFixture.userId]);
  await pool.query(`DELETE FROM "MailMessage" WHERE "sourceId" = $1`, [
    fixture.changeId,
  ]);
  await pool.query(`DELETE FROM "Invitation" WHERE id = $1`, [
    fixture.invitationId,
  ]);
  await pool.query(`DELETE FROM "User" WHERE id = $1`, [fixture.userId]);
  await pool.end();
});

describe("通用账号邮箱变更", () => {
  it("团队成员本人和平台管理员都可以发起，但其他用户不能代改", async () => {
    const selfRequested = await requestUserEmailChange(
      staffActor,
      staffFixture.userId,
      staffFixture.selfEmail,
    );
    expect(selfRequested).toMatchObject({
      oldEmail: staffFixture.oldEmail,
      newEmail: staffFixture.selfEmail,
      status: "PENDING",
    });
    await expect(
      getPendingUserEmailChange(staffActor, staffFixture.userId),
    ).resolves.toMatchObject({ newEmail: staffFixture.selfEmail });

    const customerActor: Actor = {
      id: fixture.userId,
      name: "邮箱变更测试客户",
      email: fixture.oldEmail,
      platformRole: "CUSTOMER",
      isPlatformAdmin: false,
      isStaff: false,
    };
    await expect(
      getPendingUserEmailChange(customerActor, staffFixture.userId),
    ).rejects.toThrow("无权修改该账号的登录邮箱");

    await cancelUserEmailChange(adminActor, staffFixture.userId);
    await expect(
      getPendingUserEmailChange(staffActor, staffFixture.userId),
    ).resolves.toBeNull();

    const adminRequested = await requestUserEmailChange(
      adminActor,
      staffFixture.userId,
      staffFixture.adminEmail,
    );
    expect(adminRequested).toMatchObject({
      newEmail: staffFixture.adminEmail,
      status: "PENDING",
    });
  });
});

describe("客户邮箱变更确认页", () => {
  it("GET 预览不会修改邮箱或消费令牌", async () => {
    const preview = await getEmailChangePreview(token.token);
    expect(preview).toMatchObject({
      oldEmail: fixture.oldEmail,
      newEmail: fixture.newEmail,
    });

    const state = await pool.query<{
      email: string;
      status: string;
    }>(
      `
        SELECT account.email, email_change.status::text
        FROM "User" account
        JOIN "UserEmailChange" email_change
          ON email_change."userId" = account.id
        WHERE email_change.id = $1
      `,
      [fixture.changeId],
    );
    expect(state.rows[0]).toEqual({
      email: fixture.oldEmail,
      status: "PENDING",
    });
  });

  it("POST 确认会原子迁移邮箱、邀请并撤销现有会话", async () => {
    vi.mocked(dispatchQueuedMailMessage).mockClear();

    await expect(confirmCustomerEmailChange(token.token)).resolves.toEqual({
      recipientName: "邮箱变更测试客户",
      newEmail: fixture.newEmail,
    });

    const state = await pool.query<{
      email: string;
      email_verified: boolean;
      status: string;
      session_count: string;
      invitation_email: string;
    }>(
      `
        SELECT
          account.email,
          account."emailVerified" AS email_verified,
          email_change.status::text,
          (
            SELECT COUNT(*) FROM "Session"
            WHERE "userId" = account.id
          )::text AS session_count,
          (
            SELECT email FROM "Invitation"
            WHERE id = $2
          ) AS invitation_email
        FROM "User" account
        JOIN "UserEmailChange" email_change
          ON email_change."userId" = account.id
        WHERE email_change.id = $1
      `,
      [fixture.changeId, fixture.invitationId],
    );
    expect(state.rows[0]).toEqual({
      email: fixture.newEmail,
      email_verified: true,
      status: "COMPLETED",
      session_count: "0",
      invitation_email: fixture.newEmail,
    });
    expect(dispatchQueuedMailMessage).toHaveBeenCalledTimes(2);
    const outbox = await pool.query<{
      to_email: string;
      source_type: string;
      status: string;
    }>(
      `
        SELECT
          "toEmail" AS to_email,
          "sourceType" AS source_type,
          status::text
        FROM "MailMessage"
        WHERE "sourceId" = $1
        ORDER BY "createdAt" ASC
      `,
      [fixture.changeId],
    );
    expect(outbox.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          to_email: fixture.newEmail,
          source_type: "CUSTOMER_EMAIL_CHANGE_COMPLETED",
          status: "QUEUED",
        }),
        expect.objectContaining({
          to_email: fixture.oldEmail,
          source_type: "CUSTOMER_EMAIL_CHANGE_SECURITY_NOTICE",
          status: "QUEUED",
        }),
      ]),
    );
    await expect(getEmailChangePreview(token.token)).resolves.toBeNull();
    await expect(confirmCustomerEmailChange(token.token)).rejects.toThrow(
      "确认链接无效或已使用",
    );
  });
});
