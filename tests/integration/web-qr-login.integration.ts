import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Pool } from "pg";
import type { Actor } from "@/lib/actor";
import { createCustomerSpace } from "@/modules/customer-spaces/customer-space-service";
import { acceptInvitation } from "@/modules/invitations/invitation-service";
import {
  claimSingleReissue,
  confirmWebQrLogin,
  consumeConfirmedTicket,
  createWebQrLoginTicket,
  issueWebQrSession,
} from "@/modules/miniapp/web-qr-login-service";

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
const email = `qrlogin-${run}@local.test`;
let spaceId = "";
let ownerUserId = "";

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
  const space = await createCustomerSpace(
    { ...adminRow, isPlatformAdmin: true, isStaff: true },
    {
      name: "扫码登录集成测试",
      slug: `qrlogin-${run}`,
      ownerName: "扫码登录负责人",
      ownerEmail: email,
      memberLimit: 2,
      status: "ACTIVE",
    },
  );
  spaceId = space.id;
  const outbox = await ownerPool.query<{ action_url: string }>(
    `SELECT "actionUrl" AS action_url FROM "MailMessage"
     WHERE "sourceType" = 'CUSTOMER_OWNER_INVITATION' AND "toEmail" = $1
     ORDER BY "createdAt" DESC LIMIT 1`,
    [email],
  );
  await acceptInvitation({
    token: new URL(outbox.rows[0]!.action_url).searchParams.get("token")!,
    name: "扫码登录负责人",
    password: `qr-pass-${run}-123`,
  });
  ownerUserId = (
    await ownerPool.query<{ id: string }>(
      'SELECT id FROM "User" WHERE email = $1',
      [email],
    )
  ).rows[0]!.id;
});

afterAll(async () => {
  await ownerPool.query('DELETE FROM "CustomerSpace" WHERE id = $1', [spaceId]);
  await ownerPool.query('DELETE FROM "User" WHERE email = $1', [email]);
  await ownerPool.query('DELETE FROM "MailMessage" WHERE "toEmail" = $1', [email]);
  await ownerPool.end();
});

describe("网页版扫码登录", () => {
  it("完整链路：创建票据 → 小程序确认 → Web 消费换取可用会话", async () => {
    // 1) Web 登录页创建票据（二维码为小程序码，由 wxacode 端点渲染）
    const ticket = await createWebQrLoginTicket();
    expect(ticket.token).toMatch(/^qr_[A-Za-z0-9_-]{26}$/);
    const token = ticket.token;
    const bindSecret = ticket.bindSecret;
    const pending = await consumeConfirmedTicket(
      ticket.ticketId,
      token,
      bindSecret,
    );
    expect(pending.outcome).toBe("pending");
    const wrongToken = await consumeConfirmedTicket(
      ticket.ticketId,
      "qr_forged",
      bindSecret,
    );
    expect(wrongToken.outcome).toBe("expired");
    // 绑定校验：换一个浏览器（无/错绑定 cookie）不能消费票据（防登录 CSRF）
    const wrongBind = await consumeConfirmedTicket(
      ticket.ticketId,
      token,
      "forged-bind-secret",
    );
    expect(wrongBind.outcome).toBe("expired");

    // 2) 小程序确认页（Bearer 用户）确认——t: 形态（小程序码 scene 解析结果）
    const confirmed = await confirmWebQrLogin(ownerUserId, `t:${token}`);
    expect(confirmed).toBe(true);
    // 票据一次性：再次确认失败
    const doubleConfirm = await confirmWebQrLogin(ownerUserId, `t:${ticket.token}`);
    expect(doubleConfirm).toBe(false);

    // 3) Web 轮询发现 CONFIRMED → 消费并代签会话
    const consumed = await consumeConfirmedTicket(
      ticket.ticketId,
      token,
      bindSecret,
    );
    expect(consumed.outcome).toBe("ready");
    // 重复轮询：已消费（携带正确绑定仍可识别为 already）
    const again = await consumeConfirmedTicket(
      ticket.ticketId,
      token,
      bindSecret,
    );
    expect(again.outcome).toBe("already");
    // 一次性补签声明：第一次成功，第二次拒绝（幂等，防批量铸造会话）
    const firstClaim = await claimSingleReissue(ticket.ticketId, token, bindSecret);
    expect(firstClaim?.userId).toBe(ownerUserId);
    const secondClaim = await claimSingleReissue(ticket.ticketId, token, bindSecret);
    expect(secondClaim).toBeNull();

    const { cookie } = await issueWebQrSession(ownerUserId);
    expect(cookie).toContain("better-auth.session_token=");

    // 4) 关键验证：代签 cookie 能被 better-auth 真实识别（服务端回放）
    const { auth } = await import("@/lib/auth");
    const authBaseUrl = process.env.BETTER_AUTH_URL ?? "http://127.0.0.1:3000";
    const probe = await auth.handler(
      new Request(`${authBaseUrl}/api/auth/get-session`, {
        headers: { cookie },
      }),
    );
    expect(probe.status).toBe(200);
    const session = (await probe.json()) as { user?: { id?: string } };
    expect(session.user?.id).toBe(ownerUserId);
  });

  it("过期票据不能被确认", async () => {
    const ticket = await createWebQrLoginTicket();
    // 测试库隔离：把所有 PENDING 票据置为已过期（含刚创建的这张）
    await ownerPool.query(
      `UPDATE "WebQrLoginTicket"
       SET "expiresAt" = (NOW() AT TIME ZONE 'utc') - INTERVAL '1 minute'
       WHERE status = 'PENDING'`,
    );
    const confirmed = await confirmWebQrLogin(ownerUserId, `t:${ticket.token}`);
    expect(confirmed).toBe(false);
  });
});
