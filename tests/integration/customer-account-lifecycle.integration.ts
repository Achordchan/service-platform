import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import type { Actor } from "@/lib/actor";
import {
  removeCustomerSpaceMember,
  updateCustomerSpaceMember,
} from "@/modules/customer-spaces/customer-member-service";
import { deleteCustomerSpace } from "@/modules/customer-spaces/customer-space-service";

const ownerPool = new Pool({
  connectionString: process.env.DATABASE_MIGRATION_URL,
  max: 1,
});

const fixture = {
  spaceAId: randomUUID(),
  spaceBId: randomUUID(),
  ownerAId: randomUUID(),
  ownerBId: randomUUID(),
  memberId: randomUUID(),
  spaceDeleteMemberId: randomUUID(),
  ownerManagedMemberId: randomUUID(),
  sharedId: randomUUID(),
  ownerAMembershipId: randomUUID(),
  ownerBMembershipId: randomUUID(),
  memberMembershipId: randomUUID(),
  spaceDeleteMemberMembershipId: randomUUID(),
  ownerManagedMemberMembershipId: randomUUID(),
  sharedMembershipAId: randomUUID(),
  sharedMembershipBId: randomUUID(),
};

let admin: Actor;

async function createCustomerUser(id: string, label: string) {
  const email = `${label}-${randomUUID()}@local.test`;
  await ownerPool.query(
    `INSERT INTO "User" (
       id, name, email, "emailVerified", "platformRole", "createdAt", "updatedAt"
     ) VALUES ($1, $2, $3, true, 'CUSTOMER', NOW(), NOW())`,
    [id, label, email],
  );
  await ownerPool.query(
    `INSERT INTO "Account" (
       id, "accountId", "providerId", "userId", password, "createdAt", "updatedAt"
     ) VALUES ($1, $2, 'credential', $2, 'test-password', NOW(), NOW())`,
    [randomUUID(), id],
  );
  await ownerPool.query(
    `INSERT INTO "Session" (
       id, token, "expiresAt", "userId", "createdAt", "updatedAt"
     ) VALUES ($1, $2, NOW() + INTERVAL '1 day', $3, NOW(), NOW())`,
    [randomUUID(), randomUUID(), id],
  );
}

beforeAll(async () => {
  const context = await ownerPool.query<{
    id: string;
    name: string;
    email: string;
    platform_role: Actor["platformRole"];
  }>(
    `SELECT id, name, email, "platformRole" AS platform_role
       FROM "User"
      WHERE email = 'admin@local.test'
      LIMIT 1`,
  );
  const row = context.rows[0];
  if (!row) {
    throw new Error("请先执行 pnpm test:integration:prepare 创建客户账号测试数据");
  }
  admin = {
    id: row.id,
    name: row.name,
    email: row.email,
    platformRole: row.platform_role,
    isPlatformAdmin: true,
    isStaff: true,
  };

  await createCustomerUser(fixture.ownerAId, "客户负责人A");
  await createCustomerUser(fixture.ownerBId, "客户负责人B");
  await createCustomerUser(fixture.memberId, "独占普通成员");
  await createCustomerUser(fixture.spaceDeleteMemberId, "随客户删除成员");
  await createCustomerUser(fixture.ownerManagedMemberId, "负责人删除成员");
  await createCustomerUser(fixture.sharedId, "历史共享成员");
  await ownerPool.query(
    `INSERT INTO "CustomerSpace" (
       id, name, slug, "ownerId", "memberLimit", "createdAt", "updatedAt"
     ) VALUES
       ($1, '客户账号生命周期A', $2, $3, 5, NOW(), NOW()),
       ($4, '客户账号生命周期B', $5, $6, 5, NOW(), NOW())`,
    [
      fixture.spaceAId,
      `customer-account-a-${randomUUID()}`,
      fixture.ownerAId,
      fixture.spaceBId,
      `customer-account-b-${randomUUID()}`,
      fixture.ownerBId,
    ],
  );
  await ownerPool.query(
    `INSERT INTO "Membership" (
       id, "customerSpaceId", "userId", role, "createdAt", "updatedAt"
     ) VALUES
       ($1, $2, $3, 'OWNER', NOW(), NOW()),
       ($4, $5, $6, 'OWNER', NOW(), NOW()),
       ($7, $2, $8, 'MEMBER', NOW(), NOW()),
       ($9, $2, $10, 'MEMBER', NOW(), NOW()),
       ($11, $2, $12, 'MEMBER', NOW(), NOW()),
       ($13, $5, $12, 'MEMBER', NOW(), NOW()),
       ($14, $5, $15, 'MEMBER', NOW(), NOW())`,
    [
      fixture.ownerAMembershipId,
      fixture.spaceAId,
      fixture.ownerAId,
      fixture.ownerBMembershipId,
      fixture.spaceBId,
      fixture.ownerBId,
      fixture.memberMembershipId,
      fixture.memberId,
      fixture.spaceDeleteMemberMembershipId,
      fixture.spaceDeleteMemberId,
      fixture.sharedMembershipAId,
      fixture.sharedId,
      fixture.sharedMembershipBId,
      fixture.ownerManagedMemberMembershipId,
      fixture.ownerManagedMemberId,
    ],
  );
});

afterAll(async () => {
  await ownerPool.query(
    'DELETE FROM "CustomerSpace" WHERE id = ANY($1::text[])',
    [[fixture.spaceAId, fixture.spaceBId]],
  );
  await ownerPool.query(
    `DELETE FROM "AuditLog"
      WHERE "resourceId" = ANY($1::text[])
         OR "customerSpaceId" = ANY($2::text[])`,
    [
      [
        fixture.ownerAId,
        fixture.ownerBId,
        fixture.memberId,
        fixture.spaceDeleteMemberId,
        fixture.ownerManagedMemberId,
        fixture.sharedId,
      ],
      [fixture.spaceAId, fixture.spaceBId],
    ],
  );
  await ownerPool.query('DELETE FROM "User" WHERE id = ANY($1::text[])', [
    [
      fixture.ownerAId,
      fixture.ownerBId,
      fixture.memberId,
      fixture.spaceDeleteMemberId,
      fixture.ownerManagedMemberId,
      fixture.sharedId,
    ],
  ]);
  await ownerPool.end();
});

describe.sequential("客户账号生命周期", () => {
  it("管理员可以编辑普通成员姓名", async () => {
    await expect(
      updateCustomerSpaceMember(
        admin,
        fixture.spaceAId,
        fixture.memberMembershipId,
        { name: "已更新客户成员" },
      ),
    ).resolves.toMatchObject({
      id: fixture.memberId,
      name: "已更新客户成员",
    });
  });

  it("删除独占普通成员会停用账号并清除登录态", async () => {
    await expect(
      removeCustomerSpaceMember(
        admin,
        fixture.spaceAId,
        fixture.memberMembershipId,
      ),
    ).resolves.toEqual({ accountDeleted: true });

    const state = await ownerPool.query<{
      deleted_at: Date | null;
      sessions: string;
      accounts: string;
      memberships: string;
    }>(
      `SELECT
         "deletedAt" AS deleted_at,
         (SELECT COUNT(*) FROM "Session" WHERE "userId" = $1)::text AS sessions,
         (SELECT COUNT(*) FROM "Account" WHERE "userId" = $1)::text AS accounts,
         (SELECT COUNT(*) FROM "Membership" WHERE "userId" = $1)::text AS memberships
       FROM "User" WHERE id = $1`,
      [fixture.memberId],
    );
    expect(state.rows[0]?.deleted_at).toBeInstanceOf(Date);
    expect(state.rows[0]).toMatchObject({
      sessions: "0",
      accounts: "0",
      memberships: "0",
    });
  });

  it("历史共享账号只解除当前客户关系，不误删其他客户登录", async () => {
    await expect(
      removeCustomerSpaceMember(
        admin,
        fixture.spaceAId,
        fixture.sharedMembershipAId,
      ),
    ).resolves.toEqual({ accountDeleted: false });

    const state = await ownerPool.query<{
      deleted_at: Date | null;
      sessions: string;
      accounts: string;
      memberships: string;
    }>(
      `SELECT
         "deletedAt" AS deleted_at,
         (SELECT COUNT(*) FROM "Session" WHERE "userId" = $1)::text AS sessions,
         (SELECT COUNT(*) FROM "Account" WHERE "userId" = $1)::text AS accounts,
         (SELECT COUNT(*) FROM "Membership" WHERE "userId" = $1)::text AS memberships
       FROM "User" WHERE id = $1`,
      [fixture.sharedId],
    );
    expect(state.rows[0]).toMatchObject({
      deleted_at: null,
      sessions: "1",
      accounts: "1",
      memberships: "1",
    });
  });

  it("客户负责人删除普通成员时同样会停用账号", async () => {
    const ownerRow = await ownerPool.query<{
      name: string;
      email: string;
      platform_role: Actor["platformRole"];
    }>(
      `SELECT name, email, "platformRole" AS platform_role
         FROM "User" WHERE id = $1`,
      [fixture.ownerBId],
    );
    const owner = ownerRow.rows[0];
    if (!owner) throw new Error("客户负责人测试账号不存在");
    const ownerActor: Actor = {
      id: fixture.ownerBId,
      name: owner.name,
      email: owner.email,
      platformRole: owner.platform_role,
      isPlatformAdmin: false,
      isStaff: false,
    };

    await expect(
      removeCustomerSpaceMember(
        ownerActor,
        fixture.spaceBId,
        fixture.ownerManagedMemberMembershipId,
      ),
    ).resolves.toEqual({ accountDeleted: true });

    const state = await ownerPool.query<{
      deleted_at: Date | null;
      sessions: string;
    }>(
      `SELECT
         "deletedAt" AS deleted_at,
         (SELECT COUNT(*) FROM "Session" WHERE "userId" = $1)::text AS sessions
       FROM "User" WHERE id = $1`,
      [fixture.ownerManagedMemberId],
    );
    expect(state.rows[0]?.deleted_at).toBeInstanceOf(Date);
    expect(state.rows[0]?.sessions).toBe("0");
  });

  it("删除客户空间会停用负责人和全部独占成员账号", async () => {
    await expect(
      deleteCustomerSpace(admin, fixture.spaceAId),
    ).resolves.toBeUndefined();

    const state = await ownerPool.query<{
      deleted_at: Date | null;
      sessions: string;
      accounts: string;
      spaces: string;
    }>(
      `SELECT
         "deletedAt" AS deleted_at,
         (SELECT COUNT(*) FROM "Session" WHERE "userId" = $1)::text AS sessions,
         (SELECT COUNT(*) FROM "Account" WHERE "userId" = $1)::text AS accounts,
         (SELECT COUNT(*) FROM "CustomerSpace" WHERE id = $2)::text AS spaces
       FROM "User" WHERE id = $1`,
      [fixture.ownerAId, fixture.spaceAId],
    );
    expect(state.rows[0]?.deleted_at).toBeInstanceOf(Date);
    expect(state.rows[0]).toMatchObject({
      sessions: "0",
      accounts: "0",
      spaces: "0",
    });

    const memberState = await ownerPool.query<{
      deleted_at: Date | null;
      sessions: string;
      accounts: string;
    }>(
      `SELECT
         "deletedAt" AS deleted_at,
         (SELECT COUNT(*) FROM "Session" WHERE "userId" = $1)::text AS sessions,
         (SELECT COUNT(*) FROM "Account" WHERE "userId" = $1)::text AS accounts
       FROM "User" WHERE id = $1`,
      [fixture.spaceDeleteMemberId],
    );
    expect(memberState.rows[0]?.deleted_at).toBeInstanceOf(Date);
    expect(memberState.rows[0]).toMatchObject({
      sessions: "0",
      accounts: "0",
    });
  });
});
