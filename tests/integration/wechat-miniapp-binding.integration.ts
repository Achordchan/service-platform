import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Pool } from "pg";
import type { Actor } from "@/lib/actor";
import { createCustomerSpace } from "@/modules/customer-spaces/customer-space-service";
import { acceptInvitation } from "@/modules/invitations/invitation-service";
import {
  createOwnWechatBindingCode,
  createWechatBindingCode,
  removeOwnWechatBinding,
  removeWechatBinding,
  revokeWechatBindingCode,
} from "@/modules/miniapp/binding-code-service";
import type { WechatProvider } from "@/modules/miniapp/wechat-provider";
import {
  bindTicketToAccount,
  bindTicketToCode,
  createMiniappSessionForCode,
  getMiniappMe,
  sendBindingOtp,
} from "@/modules/miniapp/wechat-binding-service";
import { reportSubscribeGrant } from "@/modules/miniapp/wechat-subscribe-message-service";
import { resolveMiniappSessionFromAuthorization } from "@/modules/miniapp/session";
import { hashBindingCode } from "@/modules/miniapp/miniapp-tokens";

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

function fakeProvider(openid: string, unionid?: string): WechatProvider {
  return { code2Session: async () => ({ openid, unionid }) };
}

const ids = {
  run: randomUUID().slice(0, 8),
  ownerEmail: "",
  ownerPassword: "binding-pass-123456",
  memberEmail: "",
  memberPassword: "member-pass-123456",
  slug: "",
  spaceId: "",
  ownerUserId: "",
  memberUserId: "",
  ownerMembershipId: "",
  memberMembershipId: "",
};

// 用例内自建的用户邮箱（随用例追加，统一在 afterAll 清理）
const cleanupEmails: string[] = [];

let admin: Actor;
let member: Actor;
const originalSettings = {
  emailOtpLoginEnabled: false,
  mailMode: "LOCAL_OUTBOX" as string,
  smtpHost: null as string | null,
  smtpPort: null as number | null,
  smtpUser: null as string | null,
  smtpPassword: null as string | null,
  smtpFrom: null as string | null,
  smtpHealthStatus: null as string | null,
};

beforeAll(async () => {
  const result = await ownerPool.query<{
    id: string;
    name: string;
    email: string;
    platformRole: Actor["platformRole"];
  }>(
    'SELECT id, name, email, "platformRole" FROM "User" WHERE email = \'admin@local.test\' LIMIT 1',
  );
  const adminUser = result.rows[0];
  if (!adminUser) {
    throw new Error("请先执行 pnpm test:integration:prepare 创建管理员测试账号");
  }
  admin = { ...adminUser, isPlatformAdmin: true, isStaff: true };

  // OTP 绑定通道依赖「邮箱验证码登录」且邮件模式非 LOCAL_OUTBOX，测试期改为 SMTP，结束后还原
  const settings = await ownerPool.query<{
    enabled: boolean;
    mode: string;
    host: string | null;
    port: number | null;
    user: string | null;
    password: string | null;
    from: string | null;
    health: string | null;
  }>(
    `SELECT "emailOtpLoginEnabled" AS enabled, "mailMode" AS mode,
            "smtpHost" AS host, "smtpPort" AS port, "smtpUser" AS user,
            "smtpPassword" AS password, "smtpFrom" AS from, "smtpHealthStatus" AS health
     FROM "PlatformSetting" WHERE id = 1`,
  );
  const current = settings.rows[0];
  Object.assign(originalSettings, {
    emailOtpLoginEnabled: current?.enabled ?? false,
    mailMode: current?.mode ?? "LOCAL_OUTBOX",
    smtpHost: current?.host ?? null,
    smtpPort: current?.port ?? null,
    smtpUser: current?.user ?? null,
    smtpPassword: current?.password ?? null,
    smtpFrom: current?.from ?? null,
    smtpHealthStatus: current?.health ?? null,
  });
  await ownerPool.query(
    `UPDATE "PlatformSetting" SET
       "emailOtpLoginEnabled" = true,
       "mailMode" = 'SMTP',
       "smtpHost" = '127.0.0.1',
       "smtpPort" = 1025,
       "smtpUser" = 'test',
       "smtpPassword" = 'test',
       "smtpFrom" = '测试 <test@local.test>',
       "smtpHealthStatus" = 'healthy'
     WHERE id = 1`,
  );

  ids.ownerEmail = `wx-owner-${ids.run}@local.test`;
  ids.memberEmail = `wx-member-${ids.run}@local.test`;
  ids.slug = `wx-bind-${ids.run}`;

  const space = await createCustomerSpace(admin, {
    name: "微信绑定集成测试",
    slug: ids.slug,
    ownerName: "绑定测试负责人",
    ownerEmail: ids.ownerEmail,
    memberLimit: 5,
    status: "ACTIVE",
  });
  ids.spaceId = space.id;

  const outbox = await ownerPool.query<{ action_url: string }>(
    `SELECT "actionUrl" AS action_url FROM "MailMessage"
     WHERE "sourceType" = 'CUSTOMER_OWNER_INVITATION' AND "toEmail" = $1
     ORDER BY "createdAt" DESC LIMIT 1`,
    [ids.ownerEmail],
  );
  const ownerToken = new URL(outbox.rows[0]!.action_url).searchParams.get("token");
  await acceptInvitation({
    token: ownerToken!,
    name: "绑定测试负责人",
    password: ids.ownerPassword,
  });
  ids.ownerUserId = (
    await ownerPool.query<{ id: string }>(
      'SELECT id FROM "User" WHERE email = $1',
      [ids.ownerEmail],
    )
  ).rows[0]!.id;

  const memberCreated = await ownerPool.query<{ membership_id: string; user_id: string }>(
    `INSERT INTO "User" (id, name, email, "emailVerified", "platformRole", "createdAt", "updatedAt")
     VALUES ($1, '绑定测试成员', $2, true, 'CUSTOMER', NOW(), NOW()) RETURNING id AS user_id`,
    [randomUUID(), ids.memberEmail],
  );
  ids.memberUserId = memberCreated.rows[0]!.user_id;
  const membership = await ownerPool.query<{ membership_id: string }>(
    `INSERT INTO "Membership" (id, "customerSpaceId", "userId", role, "createdAt", "updatedAt")
     VALUES ($1, $2, $3, 'MEMBER', NOW(), NOW()) RETURNING id AS membership_id`,
    [randomUUID(), ids.spaceId, ids.memberUserId],
  );
  ids.ownerMembershipId = (
    await ownerPool.query<{ membership_id: string }>(
      'SELECT id AS membership_id FROM "Membership" WHERE "customerSpaceId" = $1 AND "userId" = $2',
      [ids.spaceId, ids.ownerUserId],
    )
  ).rows[0]!.membership_id;
  ids.memberMembershipId = membership.rows[0]!.membership_id;

  const selectActor = async (userId: string): Promise<Actor> => {
    const row = (
      await ownerPool.query<{
        id: string;
        name: string;
        email: string;
        platformRole: Actor["platformRole"];
      }>(
        'SELECT id, name, email, "platformRole" FROM "User" WHERE id = $1',
        [userId],
      )
    ).rows[0]!;
    return { ...row, isPlatformAdmin: false, isStaff: false };
  };
  member = await selectActor(ids.memberUserId);
});

afterAll(async () => {
  await ownerPool.query(
    `UPDATE "PlatformSetting" SET
       "emailOtpLoginEnabled" = $1,
       "mailMode" = $2::"MailDeliveryMode",
       "smtpHost" = $3,
       "smtpPort" = $4,
       "smtpUser" = $5,
       "smtpPassword" = $6,
       "smtpFrom" = $7,
       "smtpHealthStatus" = $8
     WHERE id = 1`,
    [
      originalSettings.emailOtpLoginEnabled,
      originalSettings.mailMode,
      originalSettings.smtpHost,
      originalSettings.smtpPort,
      originalSettings.smtpUser,
      originalSettings.smtpPassword,
      originalSettings.smtpFrom,
      originalSettings.smtpHealthStatus,
    ],
  );
  await ownerPool.query('DELETE FROM "CustomerSpace" WHERE id = $1', [
    ids.spaceId,
  ]);
  await ownerPool.query('DELETE FROM "User" WHERE email = ANY($1::text[])', [
    [ids.ownerEmail, ids.memberEmail, ...cleanupEmails],
  ]);
  await ownerPool.query('DELETE FROM "MailMessage" WHERE "toEmail" = ANY($1::text[])', [
    [ids.ownerEmail, ids.memberEmail],
  ]);
  await ownerPool.query('DELETE FROM "WechatBindGuard" WHERE openid LIKE $1', [
    `it-openid-%${ids.run}%`,
  ]);
  await ownerPool.end();
});

describe("微信小程序登录与绑定", () => {
  it("未绑定微信首次登录返回待绑定票据，绑定码绑定后立即获得会话", async () => {
    const openid = `it-openid-member-${ids.run}`;
    const first = await createMiniappSessionForCode(
      { code: "any" },
      fakeProvider(openid),
    );
    expect(first.status).toBe("NEED_BINDING");
    if (first.status !== "NEED_BINDING") return;

    const { code } = await createWechatBindingCode(
      admin,
      ids.spaceId,
      ids.memberMembershipId,
    );
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);

    const bound = await bindTicketToCode({
      bindingTicket: first.bindingTicket,
      code: code.toLowerCase(),
    });
    expect(bound.user.id).toBe(ids.memberUserId);

    // 再次登录直接签发会话
    const second = await createMiniappSessionForCode(
      { code: "any" },
      fakeProvider(openid),
    );
    expect(second.status).toBe("SESSION_ISSUED");

    // 绑定码不可重复使用
    const other = await createMiniappSessionForCode(
      { code: "any" },
      fakeProvider(`it-openid-other-${ids.run}`),
    );
    expect(other.status).toBe("NEED_BINDING");
    if (other.status !== "NEED_BINDING") return;
    await expect(
      bindTicketToCode({ bindingTicket: other.bindingTicket, code }),
    ).rejects.toMatchObject({ code: "BINDING_CODE_INVALID" });
  });

  it("过期与被作废的绑定码均不可使用", async () => {
    const openid = `it-openid-expired-${ids.run}`;

    // 过期（列是 TIMESTAMP 无时区，全项目按 UTC 墙钟读写，必须用 AT TIME ZONE 'utc'）
    const expiredIssue = await createWechatBindingCode(
      admin,
      ids.spaceId,
      ids.memberMembershipId,
    ).then(async (issued) => {
      await ownerPool.query(
        "UPDATE \"WechatBindingCode\" SET \"expiresAt\" = (NOW() AT TIME ZONE 'utc') - INTERVAL '1 minute' WHERE id = $1",
        [issued.id],
      );
      return issued;
    });
    const expiredLogin = await createMiniappSessionForCode(
      { code: "any" },
      fakeProvider(openid),
    );
    expect(expiredLogin.status).toBe("NEED_BINDING");
    if (expiredLogin.status !== "NEED_BINDING") return;
    await expect(
      bindTicketToCode({
        bindingTicket: expiredLogin.bindingTicket,
        code: expiredIssue.code,
      }),
    ).rejects.toMatchObject({ code: "BINDING_CODE_INVALID" });

    // 作废
    const revokedIssue = await createWechatBindingCode(
      admin,
      ids.spaceId,
      ids.memberMembershipId,
    );
    await revokeWechatBindingCode(
      admin,
      ids.spaceId,
      ids.memberMembershipId,
      revokedIssue.id,
    );
    const revokedLogin = await createMiniappSessionForCode(
      { code: "any" },
      fakeProvider(openid),
    );
    expect(revokedLogin.status).toBe("NEED_BINDING");
    if (revokedLogin.status !== "NEED_BINDING") return;
    await expect(
      bindTicketToCode({
        bindingTicket: revokedLogin.bindingTicket,
        code: revokedIssue.code,
      }),
    ).rejects.toMatchObject({ code: "BINDING_CODE_INVALID" });
  });

  it("邮箱密码绑定：验证成功建立绑定，且不残留 better-auth 会话", async () => {
    const openid = `it-openid-owner-${ids.run}`;
    const login = await createMiniappSessionForCode(
      { code: "any" },
      fakeProvider(openid),
    );
    expect(login.status).toBe("NEED_BINDING");
    if (login.status !== "NEED_BINDING") return;

    const bound = await bindTicketToAccount({
      bindingTicket: login.bindingTicket,
      email: ids.ownerEmail,
      password: ids.ownerPassword,
    });
    expect(bound.user.id).toBe(ids.ownerUserId);

    const sessions = await ownerPool.query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM "Session" WHERE "userId" = $1',
      [ids.ownerUserId],
    );
    expect(sessions.rows[0]?.count).toBe("0");
  });

  it("错误密码被拒绝，连续失败触发 openid 锁定", async () => {
    const openid = `it-openid-bruteforce-${ids.run}`;
    const login = await createMiniappSessionForCode(
      { code: "any" },
      fakeProvider(openid),
    );
    expect(login.status).toBe("NEED_BINDING");
    if (login.status !== "NEED_BINDING") return;

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(
        bindTicketToAccount({
          bindingTicket: login.bindingTicket,
          email: ids.ownerEmail,
          password: "wrong-password-000",
        }),
      ).rejects.toMatchObject({ status: expect.any(Number) });
    }
    // 第 6 次：即使凭据正确也已锁定
    await expect(
      bindTicketToAccount({
        bindingTicket: login.bindingTicket,
        email: ids.ownerEmail,
        password: ids.ownerPassword,
      }),
    ).rejects.toMatchObject({ code: "BIND_ATTEMPTS_LOCKED" });
  });

  it("密码失败计数按邮箱维度锁定：更换微信也无法绕过", async () => {
    // 5 次失败使用不同 openid，全部打同一邮箱
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const login = await createMiniappSessionForCode(
        { code: "any" },
        fakeProvider(`it-openid-mailbox-${ids.run}-${attempt}`),
      );
      expect(login.status).toBe("NEED_BINDING");
      if (login.status !== "NEED_BINDING") return;
      await expect(
        bindTicketToAccount({
          bindingTicket: login.bindingTicket,
          email: ids.ownerEmail,
          password: "wrong-password-000",
        }),
      ).rejects.toMatchObject({ status: expect.any(Number) });
    }
    // 第 6 次换新 openid、密码正确：仍被邮箱维度锁定拒绝
    const fresh = await createMiniappSessionForCode(
      { code: "any" },
      fakeProvider(`it-openid-mailbox-fresh-${ids.run}`),
    );
    expect(fresh.status).toBe("NEED_BINDING");
    if (fresh.status !== "NEED_BINDING") return;
    await expect(
      bindTicketToAccount({
        bindingTicket: fresh.bindingTicket,
        email: ids.ownerEmail,
        password: ids.ownerPassword,
      }),
    ).rejects.toMatchObject({ code: "BIND_ATTEMPTS_LOCKED" });
    // 清理邮箱维度的 guard，避免影响后续用例
    await ownerPool.query(
      'DELETE FROM "WechatBindGuard" WHERE openid = $1',
      [`email:${ids.ownerEmail}`],
    );
  });

  it("一个微信和一个账号均只能绑定一次（双向唯一）", async () => {
    // owner 已绑定（上一用例），member 也已绑定（绑定码用例）
    // 用新微信绑定已绑定账号 → 拒绝
    const newOpenidLogin = await createMiniappSessionForCode(
      { code: "any" },
      fakeProvider(`it-openid-fresh-${ids.run}`),
    );
    expect(newOpenidLogin.status).toBe("NEED_BINDING");
    if (newOpenidLogin.status !== "NEED_BINDING") return;
    await expect(
      bindTicketToAccount({
        bindingTicket: newOpenidLogin.bindingTicket,
        email: ids.ownerEmail,
        password: ids.ownerPassword,
      }),
    ).rejects.toMatchObject({ code: "ACCOUNT_ALREADY_BOUND" });

    // owner 的旧 openid 换绑其他账号 → 拒绝
    const reusedOpenidLogin = await createMiniappSessionForCode(
      { code: "any" },
      fakeProvider(`it-openid-owner-${ids.run}`),
    );
    // 该 openid 已绑定 owner，登录直接给出绑定账号不可用/会话（不进入绑定流）
    if (reusedOpenidLogin.status === "NEED_BINDING") {
      await expect(
        bindTicketToAccount({
          bindingTicket: reusedOpenidLogin.bindingTicket,
          email: ids.memberEmail,
          password: ids.memberPassword,
        }),
      ).rejects.toMatchObject({ code: "WECHAT_ALREADY_BOUND" });
    } else {
      expect(reusedOpenidLogin.status).toBe("SESSION_ISSUED");
    }
  });

  it("Email OTP 绑定：无密码客户可通过验证码完成绑定", async () => {
    // member 已绑定（绑定码用例），先解绑再用 OTP 重新绑定
    await removeWechatBinding(admin, ids.spaceId, ids.memberMembershipId);

    const openid = `it-openid-otp-${ids.run}`;
    const login = await createMiniappSessionForCode(
      { code: "any" },
      fakeProvider(openid),
    );
    expect(login.status).toBe("NEED_BINDING");
    if (login.status !== "NEED_BINDING") return;

    await sendBindingOtp({
      bindingTicket: login.bindingTicket,
      email: ids.memberEmail,
    });

    // 防枚举：不存在的邮箱同样返回 sent:true，且不发信不计失败锁定的场景不受影响
    const enumProbe = await sendBindingOtp({
      bindingTicket: login.bindingTicket,
      email: `missing-${ids.run}@local.test`,
    }).then(
      () => "SENT_OK",
      (error: unknown) =>
        error instanceof Error ? `THROWN:${error.message}` : "THROWN",
    );
    expect(enumProbe).toBe("SENT_OK");
    const noMail = await ownerPool.query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM "MailMessage" WHERE "toEmail" = $1',
      [`missing-${ids.run}@local.test`],
    );
    expect(noMail.rows[0]?.count).toBe("0");
    const mail = await ownerPool.query<{ body: string }>(
      `SELECT body FROM "MailMessage"
       WHERE "sourceType" = 'LOGIN_EMAIL_OTP' AND "toEmail" = $1
       ORDER BY "createdAt" DESC LIMIT 1`,
      [ids.memberEmail],
    );
    const otp = mail.rows[0]?.body.match(/\b(\d{6})\b/)?.[1];
    expect(otp).toBeTruthy();

    const bound = await bindTicketToAccount({
      bindingTicket: login.bindingTicket,
      email: ids.memberEmail,
      otp: otp!,
    });
    expect(bound.user.id).toBe(ids.memberUserId);
  });

  it("小程序会话可解析为 Actor，解绑后立即失效且可重新绑定", async () => {
    const resolved = await resolveMiniappSessionFromAuthorization(
      "Bearer definitely-not-a-real-token",
    );
    expect(resolved).toBeNull();

    // member 当前会话来自 OTP 绑定用例：直接重新登录拿 token
    const login = await createMiniappSessionForCode(
      { code: "any" },
      fakeProvider(`it-openid-otp-${ids.run}`),
    );
    expect(login.status).toBe("SESSION_ISSUED");
    if (login.status !== "SESSION_ISSUED") return;

    const session = await resolveMiniappSessionFromAuthorization(
      `Bearer ${login.token}`,
    );
    expect(session?.actor.id).toBe(ids.memberUserId);
    expect(session?.actor.platformRole).toBe("CUSTOMER");

    const me = await getMiniappMe(session!.actor);
    expect(me.wechatBinding).not.toBeNull();
    expect(me.customerSpaces.map((s) => s.name)).toContain("微信绑定集成测试");

    await removeWechatBinding(admin, ids.spaceId, ids.memberMembershipId);
    const afterUnbind = await resolveMiniappSessionFromAuthorization(
      `Bearer ${login.token}`,
    );
    expect(afterUnbind).toBeNull();

    const bindingCount = await ownerPool.query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM "WechatBinding" WHERE "userId" = $1',
      [ids.memberUserId],
    );
    expect(bindingCount.rows[0]?.count).toBe("0");

    // 解绑后同一账号可绑定新的微信
    const rebindLogin = await createMiniappSessionForCode(
      { code: "any" },
      fakeProvider(`it-openid-rebind-${ids.run}`),
    );
    expect(rebindLogin.status).toBe("NEED_BINDING");
    if (rebindLogin.status !== "NEED_BINDING") return;
    const { code } = await createWechatBindingCode(
      admin,
      ids.spaceId,
      ids.memberMembershipId,
    );
    const rebound = await bindTicketToCode({
      bindingTicket: rebindLogin.bindingTicket,
      code,
    });
    expect(rebound.user.id).toBe(ids.memberUserId);
  });

  it("绑定码的哈希以规范化形式入库（不存明文）", async () => {
    const { code, id } = await createWechatBindingCode(
      admin,
      ids.spaceId,
      ids.memberMembershipId,
    );
    const stored = await ownerPool.query<{ hash: string }>(
      'SELECT "codeHash" AS hash FROM "WechatBindingCode" WHERE id = $1',
      [id],
    );
    expect(stored.rows[0]?.hash).toBe(hashBindingCode(code));
    expect(stored.rows[0]?.hash).not.toContain(code);
  });

  it("非管理员且非 Owner 不能管理绑定码", async () => {
    // member 是普通 MEMBER，对空间无管理权
    await expect(
      createWechatBindingCode(member, ids.spaceId, ids.ownerMembershipId),
    ).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
  });

  it("自助生成绑定码并发时仍保持单一有效码", async () => {
    // 自助路径不校验空间成员关系，直接用一个独立用户验证并发串行化
    const email = `wx-self-${ids.run}@local.test`;
    const selfUserId = (
      await ownerPool.query<{ id: string }>(
        `INSERT INTO "User" (id, name, email, "emailVerified", "platformRole", "createdAt", "updatedAt")
         VALUES ($1, '自助绑定码测试', $2, true, 'CUSTOMER', NOW(), NOW()) RETURNING id`,
        [randomUUID(), email],
      )
    ).rows[0]!.id;
    cleanupEmails.push(email);
    const selfActor: Actor = {
      id: selfUserId,
      name: "自助绑定码测试",
      email,
      platformRole: "CUSTOMER",
      isPlatformAdmin: false,
      isStaff: false,
    };

    const [first, second] = await Promise.all([
      createOwnWechatBindingCode(selfActor),
      createOwnWechatBindingCode(selfActor),
    ]);
    expect(first.code).not.toBe(second.code);

    // 先完成的请求返回的码必须被后完成的请求作废，最终只剩一条未撤销码
    const rows = await ownerPool.query<{ revoked: boolean }>(
      'SELECT ("revokedAt" IS NULL) AS revoked FROM "WechatBindingCode" WHERE "userId" = $1',
      [selfUserId],
    );
    expect(rows.rows).toHaveLength(2);
    expect(rows.rows.filter((row) => row.revoked)).toHaveLength(1);
  });

  it("解绑后本人残留的未使用绑定码全部作废且不可再用于绑定", async () => {
    const email = `wx-unbind-${ids.run}@local.test`;
    const unbindUserId = (
      await ownerPool.query<{ id: string }>(
        `INSERT INTO "User" (id, name, email, "emailVerified", "platformRole", "createdAt", "updatedAt")
         VALUES ($1, '解绑残留码测试', $2, true, 'CUSTOMER', NOW(), NOW()) RETURNING id`,
        [randomUUID(), email],
      )
    ).rows[0]!.id;
    cleanupEmails.push(email);
    const unbindMembershipId = (
      await ownerPool.query<{ id: string }>(
        `INSERT INTO "Membership" (id, "customerSpaceId", "userId", role, "createdAt", "updatedAt")
         VALUES ($1, $2, $3, 'MEMBER', NOW(), NOW()) RETURNING id`,
        [randomUUID(), ids.spaceId, unbindUserId],
      )
    ).rows[0]!.id;
    const unbindActor: Actor = {
      id: unbindUserId,
      name: "解绑残留码测试",
      email,
      platformRole: "CUSTOMER",
      isPlatformAdmin: false,
      isStaff: false,
    };

    // 绑定前自助生成一条；管理员另补一条备用（备用码可在绑定后继续存留）
    const own = await createOwnWechatBindingCode(unbindActor);
    const spare = await createWechatBindingCode(
      admin,
      ids.spaceId,
      unbindMembershipId,
    );

    // 首次绑定消耗自助生成的码，此时名下仍剩一条活跃备用码
    const login = await createMiniappSessionForCode(
      { code: "any" },
      fakeProvider(`it-openid-unbind-${ids.run}`),
    );
    expect(login.status).toBe("NEED_BINDING");
    if (login.status !== "NEED_BINDING") return;
    const bound = await bindTicketToCode({
      bindingTicket: login.bindingTicket,
      code: own.code.toLowerCase(),
    });
    expect(bound.user.id).toBe(unbindUserId);
    const before = await ownerPool.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM "WechatBindingCode" WHERE "userId" = $1 AND "usedAt" IS NULL AND "revokedAt" IS NULL',
      [unbindUserId],
    );
    expect(before.rows[0]?.count).toBe(1);

    // 订阅授权额度归属旧 openid：解绑也必须清空，防止换绑后拿残留额度误发
    await ownerPool.query(
      `INSERT INTO "WechatSubscribeGrant" (id, "userId", "templateKey", remaining, "updatedAt")
       VALUES ($1, $2, 'STATUS_UPDATE', 5, NOW())`,
      [randomUUID(), unbindUserId],
    );

    await expect(removeOwnWechatBinding(unbindActor)).resolves.toMatchObject({
      removed: true,
    });

    // 解绑必须连带作废全部未使用码：否则持码人可把微信绑到刚解绑的账号上
    const after = await ownerPool.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM "WechatBindingCode" WHERE "userId" = $1 AND "usedAt" IS NULL AND "revokedAt" IS NULL',
      [unbindUserId],
    );
    expect(after.rows[0]?.count).toBe(0);
    const grantsLeft = await ownerPool.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM "WechatSubscribeGrant" WHERE "userId" = $1',
      [unbindUserId],
    );
    expect(grantsLeft.rows[0]?.count).toBe(0);

    // 解绑后迟到的订阅上报不得重建孤儿额度（会变成换绑后的误发配额）
    await expect(
      reportSubscribeGrant(unbindUserId, "REQUEST_STATUS"),
    ).resolves.toEqual({ remaining: 0 });
    const grantsRebuilt = await ownerPool.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM "WechatSubscribeGrant" WHERE "userId" = $1',
      [unbindUserId],
    );
    expect(grantsRebuilt.rows[0]?.count).toBe(0);

    // 未过期但已被解绑作废的备用码同样不能再完成绑定
    const retry = await createMiniappSessionForCode(
      { code: "any" },
      fakeProvider(`it-openid-unbind-retry-${ids.run}`),
    );
    if (retry.status === "NEED_BINDING") {
      await expect(
        bindTicketToCode({ bindingTicket: retry.bindingTicket, code: spare.code }),
      ).rejects.toMatchObject({ code: "BINDING_CODE_INVALID" });
    }
  });
});
