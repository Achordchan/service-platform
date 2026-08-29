import "server-only";

import { APIError } from "better-auth/api";
import type { Actor } from "@/lib/actor";
import { resolveActor, withActorDb } from "@/lib/actor";
import { auth } from "@/lib/auth";
import { internalTurnstileBypassHeaders } from "@/lib/turnstile";
import { prisma } from "@/lib/db";
import { writeAuditLog } from "@/modules/audit/audit-service";
import { recordAuthEvent } from "@/modules/audit/auth-audit";
import {
  createAuthTicket,
  createMiniappSessionToken,
  hashBindingCode,
  hashSecretToken,
  maskOpenid,
} from "@/modules/miniapp/miniapp-tokens";
import {
  getWechatProvider,
  type WechatProvider,
} from "@/modules/miniapp/wechat-provider";
import { DomainError } from "@/modules/projects/errors";

const BIND_GUARD_MAX_FAILS = 5;
const BIND_GUARD_LOCK_MS = 10 * 60 * 1000;
const BIND_GUARD_DECAY_MS = 15 * 60 * 1000;
const BINDING_OTP_MAX_PER_TICKET = 3;
const BINDING_OTP_EMAIL_COOLDOWN_MS = 60 * 1000;

export type MiniappLoginResult =
  | { status: "SESSION_ISSUED"; token: string; expiresAt: Date }
  | {
      status: "NEED_BINDING";
      bindingTicket: string;
      ticketExpiresAt: Date;
    };

export type MiniappSessionIssued = {
  token: string;
  expiresAt: Date;
  user: { id: string; name: string; email: string };
};

type PendingTicket = {
  id: string;
  openid: string;
  unionid: string | null;
};

/** 请求边界解析的可信来源（路由层用 clientIpFromHeaders 提取），仅用于审计记录 */
export type RequestNetwork = {
  ipAddress: string | null;
  userAgent: string | null;
};

export async function createMiniappSessionForCode(
  input: { code: string },
  provider: Pick<WechatProvider, "code2Session"> = getWechatProvider(),
  network?: RequestNetwork,
): Promise<MiniappLoginResult> {
  const identity = await provider.code2Session(input.code);
  const binding = await prisma.wechatBinding.findUnique({
    where: { openid: identity.openid },
    select: {
      userId: true,
      // 客户与内部人员均可绑定登录；仅拦截已删除账号
      user: { select: { deletedAt: true } },
    },
  });
  if (binding) {
    if (binding.user.deletedAt) {
      throw new DomainError(
        "BINDING_ACCOUNT_UNAVAILABLE",
        "绑定的账号当前不可用，请联系客服处理",
        403,
      );
    }
    const session = await issueSessionForBinding(
      binding.userId,
      identity.openid,
    );
    // 小程序会话不经 better-auth adapter，databaseHooks 不触发，需显式补登录审计
    await recordAuthEvent({
      action: "USER_LOGIN",
      actorUserId: binding.userId,
      targetUserId: binding.userId,
      ipAddress: network?.ipAddress ?? null,
      userAgent: network?.userAgent ?? null,
      metadata: { path: "miniapp" },
    });
    return { status: "SESSION_ISSUED", ...session };
  }

  const ticketData = createAuthTicket();
  await prisma.miniappAuthTicket.create({
    data: {
      ticketHash: ticketData.ticketHash,
      openid: identity.openid,
      unionid: identity.unionid ?? null,
      expiresAt: ticketData.expiresAt,
    },
  });
  return {
    status: "NEED_BINDING",
    bindingTicket: ticketData.ticket,
    ticketExpiresAt: ticketData.expiresAt,
  };
}

export async function bindTicketToAccount(
  input: {
    bindingTicket: string;
    email: string;
    password?: string;
    otp?: string;
  },
  network?: RequestNetwork,
): Promise<MiniappSessionIssued> {
  const ticket = await loadPendingTicket(input.bindingTicket);
  await assertBindNotLocked(ticket.openid, `email:${input.email}`);

  let verifiedUserId: string | null = null;
  let verifySessionToken: string | undefined;
  try {
    if (input.password !== undefined) {
      const result = await auth.api.signInEmail({
        body: { email: input.email, password: input.password },
        headers: internalTurnstileBypassHeaders(),
      });
      verifiedUserId = result.user.id;
      verifySessionToken = result.token;
    } else {
      const result = await auth.api.signInEmailOTP({
        body: { email: input.email, otp: input.otp ?? "" },
        headers: internalTurnstileBypassHeaders(),
      });
      verifiedUserId = result.user.id;
      verifySessionToken = result.token;
    }
  } catch (error) {
    await recordBindFailure(ticket.openid).catch(() => undefined);
    await recordBindFailure(`email:${input.email}`).catch(() => undefined);
    // better-auth 内部走 Turnstile 旁路头，Web 端登录失败钩子对其静默，
    // 小程序侧的凭据验证失败在此补记（含被尝试的邮箱与可信来源）
    await recordAuthEvent({
      action: "USER_LOGIN_FAILED",
      email: input.email,
      result: "FAILURE",
      ipAddress: network?.ipAddress ?? null,
      userAgent: network?.userAgent ?? null,
      metadata: { path: "miniapp-bind" },
    });
    throw mapBetterAuthError(error, "身份验证失败，请检查邮箱与凭据");
  } finally {
    // better-auth 验证会签发 Web Session；此处仅作为验证手段，立即清除
    if (verifySessionToken) {
      await prisma.session
        .deleteMany({ where: { token: verifySessionToken } })
        .catch(() => undefined);
    }
  }

  const user = await loadBindableUser(verifiedUserId);
  return bindOpenidToUser({
    openid: ticket.openid,
    unionid: ticket.unionid,
    userId: user.id,
    userName: user.name,
    userEmail: user.email,
    ticketId: ticket.id,
    method: "account",
    network,
  });
}

export async function sendBindingOtp(input: {
  bindingTicket: string;
  email: string;
}): Promise<{ sent: true }> {
  const ticket = await loadPendingTicket(input.bindingTicket);
  // 防枚举/防轰炸约束（详见 sendBindingOtpSilently）：
  // 锁定状态下直接拒绝；其余失败路径一律返回 { sent: true }，不区分
  // 「邮箱不存在 / 已绑定 / 冷却中 / 发送失败」，避免探测客户账号。
  await assertBindNotLocked(ticket.openid);
  await sendBindingOtpSilently(ticket, input.email);
  return { sent: true };
}

async function sendBindingOtpSilently(
  ticket: PendingTicket,
  email: string,
): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, deletedAt: true },
  });
  // 客户与内部人员账号均可绑定，仅排除已删除账号
  const bindable = user && !user.deletedAt;
  if (!bindable) {
    // 邮箱不是可绑定账号：计入防暴力计数，且不暴露存在性
    await recordBindFailure(ticket.openid).catch(() => undefined);
    return;
  }
  const bound = await prisma.wechatBinding.findUnique({
    where: { userId: user!.id },
    select: { id: true },
  });
  if (bound) {
    await recordBindFailure(ticket.openid).catch(() => undefined);
    return;
  }

  // 按邮箱冷却：60 秒内已发过验证码（Verification 表有 identifier 索引）则跳过。
  // better-auth email-otp 插件的 identifier 形如 `sign-in-otp-<email小写>`，
  // 按裸邮箱查永远匹配不到（冷却失效，仅剩 better-auth 自身限流兜底）
  const recent = await prisma.verification.findFirst({
    where: {
      identifier: `sign-in-otp-${email.trim().toLowerCase()}`,
      createdAt: { gt: new Date(Date.now() - BINDING_OTP_EMAIL_COOLDOWN_MS) },
    },
    select: { id: true },
  });
  if (recent) return;

  const claimed = await prisma.miniappAuthTicket.updateMany({
    where: { id: ticket.id, otpSentCount: { lt: BINDING_OTP_MAX_PER_TICKET } },
    data: { otpSentCount: { increment: 1 } },
  });
  if (claimed.count === 0) {
    // 每票据 3 次上限；超限静默返回，提示语义由前端倒计时承担
    return;
  }
  try {
    await auth.api.sendVerificationOTP({
      body: { email, type: "sign-in" },
      headers: internalTurnstileBypassHeaders(),
    });
  } catch (error) {
    await prisma.miniappAuthTicket
      .update({
        where: { id: ticket.id },
        data: { otpSentCount: { decrement: 1 } },
      })
      .catch(() => undefined);
    // better-auth 侧限流（同邮箱 60s 内多次）等场景：静默不计失败
    if (!(error instanceof APIError)) {
      await recordBindFailure(ticket.openid).catch(() => undefined);
    }
  }
}

export async function bindTicketToCode(
  input: {
    bindingTicket: string;
    code: string;
  },
  network?: RequestNetwork,
): Promise<MiniappSessionIssued> {
  const ticket = await loadPendingTicket(input.bindingTicket);
  await assertBindNotLocked(ticket.openid);

  const codeRecord = await prisma.wechatBindingCode.findUnique({
    where: { codeHash: hashBindingCode(input.code) },
    select: { id: true, userId: true, expiresAt: true, usedAt: true, revokedAt: true },
  });
  const usable =
    codeRecord &&
    !codeRecord.usedAt &&
    !codeRecord.revokedAt &&
    codeRecord.expiresAt.getTime() > Date.now();
  if (!usable) {
    await recordBindFailure(ticket.openid).catch(() => undefined);
    // 统一错误文案，避免探测绑定码状态
    throw new DomainError("BINDING_CODE_INVALID", "绑定码无效或已过期", 400);
  }

  const user = await loadBindableUser(codeRecord!.userId);
  try {
    return await bindOpenidToUser({
      openid: ticket.openid,
      unionid: ticket.unionid,
      userId: user.id,
      userName: user.name,
      userEmail: user.email,
      ticketId: ticket.id,
      method: "code",
      bindingCodeId: codeRecord!.id,
      network,
    });
  } catch (error) {
    if (error instanceof DomainError && error.code === "BINDING_CODE_CLAIMED") {
      await recordBindFailure(ticket.openid).catch(() => undefined);
      throw new DomainError("BINDING_CODE_INVALID", "绑定码无效或已过期", 400);
    }
    throw error;
  }
}

export function getMiniappMe(actor: Actor) {
  // Membership 受 RLS 保护，必须经 withActorDb 设置 app.user_id 后查询。
  // 注意顺序执行：withActorDb 是单个 pg 连接，Promise.all 并发查询在
  // pg 上只是串行排队（重入警告，pg 9 起直接报错）
  return withActorDb(actor, async (tx) => {
    const binding = await tx.wechatBinding.findUnique({
      where: { userId: actor.id },
      select: { createdAt: true, lastLoginAt: true },
    });
    // 客户空间隶属只对客户账号有意义；内部人员走 ProjectStaff，不查 Membership
    const spaces = actor.isStaff
      ? []
      : await tx.membership.findMany({
          where: {
            userId: actor.id,
            customerSpace: { kind: "STANDARD", status: "ACTIVE" },
          },
          select: {
            role: true,
            customerSpace: { select: { id: true, name: true } },
          },
          orderBy: { createdAt: "asc" },
        });
    return {
      user: { id: actor.id, name: actor.name, email: actor.email },
      // 客户端按角色切换后台模式，并据权限清单决定展示哪些员工操作
      platformRole: actor.platformRole,
      isStaff: actor.isStaff,
      isPlatformAdmin: actor.isPlatformAdmin,
      permissions: actor.permissions ?? [],
      wechatBinding: binding
        ? { boundAt: binding.createdAt, lastLoginAt: binding.lastLoginAt }
        : null,
      customerSpaces: spaces.map((space) => ({
        id: space.customerSpace.id,
        name: space.customerSpace.name,
        role: space.role,
      })),
    };
  });
}

// openid+userId 双条件守卫：解绑（DELETE binding）与登录并发时，绑定行在读取后、
// 会话创建前被删除的话，updateMany 命中 0 行 → 拒绝签发（防 TOCTOU 残留孤儿会话）。
// 同时匹配 userId 防止「快速解绑→换绑到其他账号」后按旧读取值错配签发。
async function issueSessionForBinding(userId: string, openid?: string) {
  const tokenData = createMiniappSessionToken();
  const issued = await prisma.$transaction(async (tx) => {
    const touched = await tx.wechatBinding.updateMany({
      where: openid ? { openid, userId } : { userId },
      data: { lastLoginAt: new Date() },
    });
    if (touched.count === 0) return false;
    await tx.miniappSession.create({
      data: {
        tokenHash: tokenData.tokenHash,
        userId,
        expiresAt: tokenData.expiresAt,
      },
    });
    return true;
  });
  if (!issued) {
    throw new DomainError(
      "BINDING_GONE",
      "微信绑定已解除，请重新登录并绑定",
      401,
    );
  }
  return { token: tokenData.token, expiresAt: tokenData.expiresAt };
}

async function loadPendingTicket(ticket: string): Promise<PendingTicket> {
  const record = await prisma.miniappAuthTicket.findUnique({
    where: { ticketHash: hashSecretToken(ticket) },
    select: {
      id: true,
      openid: true,
      unionid: true,
      consumedAt: true,
      expiresAt: true,
    },
  });
  if (
    !record ||
    record.consumedAt ||
    record.expiresAt.getTime() <= Date.now()
  ) {
    throw new DomainError(
      "BINDING_TICKET_INVALID",
      "登录状态已过期，请返回重新登录",
      401,
    );
  }
  return { id: record.id, openid: record.openid, unionid: record.unionid };
}

async function loadBindableUser(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true, deletedAt: true },
  });
  if (!user || user.deletedAt) {
    throw new DomainError(
      "BINDING_ACCOUNT_UNAVAILABLE",
      "账号当前不可用，无法完成绑定",
      403,
    );
  }
  return user;
}

async function bindOpenidToUser(params: {
  openid: string;
  unionid: string | null;
  userId: string;
  userName: string;
  userEmail: string;
  ticketId: string;
  method: "account" | "code";
  bindingCodeId?: string;
  network?: RequestNetwork;
}): Promise<MiniappSessionIssued> {
  const tokenData = createMiniappSessionToken();
  const now = new Date();
  const actor = await resolveActor(params.userId);
  if (!actor) {
    throw new DomainError(
      "BINDING_ACCOUNT_UNAVAILABLE",
      "账号当前不可用，无法完成绑定",
      403,
    );
  }
  try {
    await withActorDb(actor, async (tx) => {
      const existingByOpenid = await tx.wechatBinding.findUnique({
        where: { openid: params.openid },
        select: { userId: true },
      });
      if (existingByOpenid) {
        throw new DomainError(
          "WECHAT_ALREADY_BOUND",
          "该微信已绑定其他账号，如需更换请先解绑",
          409,
        );
      }
      const existingByUser = await tx.wechatBinding.findUnique({
        where: { userId: params.userId },
        select: { id: true },
      });
      if (existingByUser) {
        throw new DomainError(
          "ACCOUNT_ALREADY_BOUND",
          "该账号已绑定其他微信，如需更换请先解绑",
          409,
        );
      }
      if (params.bindingCodeId) {
        const claimed = await tx.wechatBindingCode.updateMany({
          where: {
            id: params.bindingCodeId,
            usedAt: null,
            revokedAt: null,
          },
          data: { usedAt: now, usedByOpenid: params.openid },
        });
        if (claimed.count === 0) {
          throw new DomainError(
            "BINDING_CODE_CLAIMED",
            "绑定码无效或已过期",
            400,
          );
        }
      }
      const binding = await tx.wechatBinding.create({
        data: {
          userId: params.userId,
          openid: params.openid,
          unionid: params.unionid,
          lastLoginAt: now,
        },
        select: { id: true },
      });
      await tx.miniappSession.create({
        data: {
          tokenHash: tokenData.tokenHash,
          userId: params.userId,
          expiresAt: tokenData.expiresAt,
        },
      });
      await tx.miniappAuthTicket.updateMany({
        where: { id: params.ticketId, consumedAt: null },
        data: { consumedAt: now },
      });
      await tx.wechatBindGuard.deleteMany({
        where: { openid: { in: [params.openid, `email:${params.userEmail}`] } },
      });
      await writeAuditLog(tx, actor, {
        action:
          params.method === "code"
            ? "WECHAT_BOUND_VIA_CODE"
            : "WECHAT_BOUND_VIA_ACCOUNT",
        resourceType: "WechatBinding",
        resourceId: binding.id,
        ipAddress: params.network?.ipAddress ?? undefined,
        userAgent: params.network?.userAgent ?? undefined,
        metadata: {
          openid: maskOpenid(params.openid),
          method: params.method,
          email: params.userEmail,
        },
      });
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      // 并发绑定触发唯一约束时给出与业务检查一致的提示
      throw new DomainError(
        "WECHAT_ALREADY_BOUND",
        "该微信或账号已被绑定，如需更换请先解绑",
        409,
      );
    }
    throw error;
  }
  // 绑定成功同时签发了小程序会话，等同一次登录；同样绕过 better-auth，显式补审计
  await recordAuthEvent({
    action: "USER_LOGIN",
    actorUserId: params.userId,
    targetUserId: params.userId,
    ipAddress: params.network?.ipAddress ?? null,
    userAgent: params.network?.userAgent ?? null,
    metadata: { path: "miniapp-bind", method: params.method },
  });
  return {
    token: tokenData.token,
    expiresAt: tokenData.expiresAt,
    user: { id: params.userId, name: params.userName, email: params.userEmail },
  };
}

async function assertBindNotLocked(...identities: string[]) {
  const guards = await prisma.wechatBindGuard.findMany({
    where: { openid: { in: identities } },
    select: { lockedUntil: true },
  });
  const locked = guards.some(
    (guard) => guard.lockedUntil && guard.lockedUntil.getTime() > Date.now(),
  );
  if (locked) {
    throw new DomainError(
      "BIND_ATTEMPTS_LOCKED",
      "尝试次数过多，请 10 分钟后再试",
      429,
    );
  }
}

// 全原子计数：任何一步都是条件更新/原子递增，并发失败请求不会互相覆盖计数
//（旧实现先读后写，并发下可绕过 5 次锁定阈值）
async function recordBindFailure(identity: string) {
  const now = new Date();
  // 1) 距上次失败超过衰减窗口：清零重来（幂等，并发同时触发无害）
  await prisma.wechatBindGuard.updateMany({
    where: {
      openid: identity,
      updatedAt: { lt: new Date(now.getTime() - BIND_GUARD_DECAY_MS) },
    },
    data: { failCount: 0, lockedUntil: null },
  });
  // 2) 原子递增（openid 唯一键 upsert 走 INSERT ... ON CONFLICT DO UPDATE）
  const guard = await prisma.wechatBindGuard.upsert({
    where: { openid: identity },
    create: { openid: identity, failCount: 1 },
    update: { failCount: { increment: 1 } },
    select: { failCount: true },
  });
  // 3) 达到阈值：锁定 10 分钟并清零（锁定即惩罚，解锁后从 1 重新累计）
  if (guard.failCount >= BIND_GUARD_MAX_FAILS) {
    await prisma.wechatBindGuard.updateMany({
      where: { openid: identity, failCount: { gte: BIND_GUARD_MAX_FAILS } },
      data: {
        failCount: 0,
        lockedUntil: new Date(now.getTime() + BIND_GUARD_LOCK_MS),
      },
    });
  }
}

function mapBetterAuthError(error: unknown, fallbackMessage: string) {
  if (error instanceof DomainError) return error;
  if (error instanceof APIError) {
    const status =
      typeof error.status === "number" && error.status >= 400 && error.status < 600
        ? error.status
        : 400;
    const body = error.body as { code?: string } | null | undefined;
    return new DomainError(
      body?.code ?? "AUTH_VERIFICATION_FAILED",
      error.message || fallbackMessage,
      status,
    );
  }
  return new DomainError("AUTH_VERIFICATION_FAILED", fallbackMessage, 401);
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}
