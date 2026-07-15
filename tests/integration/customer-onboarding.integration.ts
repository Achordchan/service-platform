import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Pool } from "pg";
import type { Actor } from "@/lib/actor";
import {
  assertMailDeliveryReady,
  enqueueMail,
} from "@/lib/jobs";
import { createCustomerSpace } from "@/modules/customer-spaces/customer-space-service";
import { acceptInvitation } from "@/modules/invitations/invitation-service";

vi.mock("@/lib/jobs", () => ({
  assertMailDeliveryReady: vi.fn().mockResolvedValue("RESEND"),
  enqueueMail: vi.fn().mockResolvedValue("test-job"),
}));

const ownerPool = new Pool({
  connectionString: process.env.DATABASE_MIGRATION_URL,
  max: 1,
});

const fixture = {
  email: `onboarding-${randomUUID()}@local.test`,
  slug: `onboarding-${randomUUID()}`,
  spaceId: "",
};

let admin: Actor;

beforeAll(async () => {
  const result = await ownerPool.query<{
    id: string;
    name: string;
    email: string;
    platformRole: Actor["platformRole"];
  }>(
    `
      SELECT id, name, email, "platformRole"
      FROM "User"
      WHERE email = 'admin@local.test'
      LIMIT 1
    `,
  );
  const user = result.rows[0];
  if (!user) {
    throw new Error("请先执行 pnpm db:seed 创建管理员测试账号");
  }
  admin = {
    ...user,
    isPlatformAdmin: true,
    isStaff: true,
  };
});

afterAll(async () => {
  if (fixture.spaceId) {
    await ownerPool.query('DELETE FROM "CustomerSpace" WHERE id = $1', [
      fixture.spaceId,
    ]);
  }
  await ownerPool.query('DELETE FROM "User" WHERE email = $1', [
    fixture.email,
  ]);
  await ownerPool.end();
});

describe("客户开户与 Owner 邀请", () => {
  it("创建空间、预创建客户，并允许满额空间的 Owner 完成账号设置", async () => {
    const space = await createCustomerSpace(admin, {
      name: "开户集成测试",
      slug: fixture.slug,
      ownerName: "测试客户",
      ownerEmail: fixture.email,
      memberLimit: 1,
      status: "ACTIVE",
    });
    fixture.spaceId = space.id;

    expect(space.owner.email).toBe(fixture.email);
    expect(space._count.memberships).toBe(1);
    expect(enqueueMail).toHaveBeenCalledOnce();

    const mail = vi.mocked(enqueueMail).mock.calls[0][0];
    expect(mail.actionUrl).toBeTruthy();
    const token = new URL(mail.actionUrl!).searchParams.get("token");
    expect(token).toBeTruthy();

    const beforeAcceptance = await ownerPool.query<{
      role: string;
      account_count: string;
      invitation_count: string;
    }>(
      `
        SELECT
          m.role,
          (
            SELECT COUNT(*) FROM "Account" a
            WHERE a."userId" = u.id AND a."providerId" = 'credential'
          )::text AS account_count,
          (
            SELECT COUNT(*) FROM "Invitation" i
            WHERE i."customerSpaceId" = m."customerSpaceId"
              AND i.role = 'OWNER'
              AND i."acceptedAt" IS NULL
          )::text AS invitation_count
        FROM "Membership" m
        JOIN "User" u ON u.id = m."userId"
        WHERE m."customerSpaceId" = $1 AND u.email = $2
      `,
      [space.id, fixture.email],
    );
    expect(beforeAcceptance.rows[0]).toEqual({
      role: "OWNER",
      account_count: "0",
      invitation_count: "1",
    });

    const acceptance = await acceptInvitation({
      token: token!,
      name: "测试客户",
      password: "Onboarding!2026",
    });
    expect(acceptance.accountExists).toBe(false);

    const afterAcceptance = await ownerPool.query<{
      email_verified: boolean;
      account_count: string;
      accepted_count: string;
    }>(
      `
        SELECT
          u."emailVerified" AS email_verified,
          (
            SELECT COUNT(*) FROM "Account" a
            WHERE a."userId" = u.id AND a."providerId" = 'credential'
          )::text AS account_count,
          (
            SELECT COUNT(*) FROM "Invitation" i
            WHERE i."customerSpaceId" = $1 AND i."acceptedAt" IS NOT NULL
          )::text AS accepted_count
        FROM "User" u
        WHERE u.email = $2
      `,
      [space.id, fixture.email],
    );
    expect(afterAcceptance.rows[0]).toEqual({
      email_verified: true,
      account_count: "1",
      accepted_count: "1",
    });

    await expect(
      acceptInvitation({
        token: token!,
        name: "测试客户",
        password: "Onboarding!2026",
      }),
    ).rejects.toThrow("INVITATION_INVALID");
  });

  it("邮件通道未启用时不会留下半创建的客户或空间", async () => {
    const blockedEmail = `blocked-${randomUUID()}@local.test`;
    const blockedSlug = `blocked-${randomUUID()}`;
    vi.mocked(assertMailDeliveryReady).mockRejectedValueOnce(
      new Error("邮件服务尚未启用"),
    );

    await expect(
      createCustomerSpace(admin, {
        name: "不应创建的客户",
        slug: blockedSlug,
        ownerName: "测试客户",
        ownerEmail: blockedEmail,
        memberLimit: 1,
        status: "ACTIVE",
      }),
    ).rejects.toThrow("邮件服务尚未启用");

    const result = await ownerPool.query<{
      space_count: string;
      user_count: string;
    }>(
      `
        SELECT
          (
            SELECT COUNT(*) FROM "CustomerSpace" WHERE slug = $1
          )::text AS space_count,
          (
            SELECT COUNT(*) FROM "User" WHERE email = $2
          )::text AS user_count
      `,
      [blockedSlug, blockedEmail],
    );
    expect(result.rows[0]).toEqual({
      space_count: "0",
      user_count: "0",
    });
  });
});
