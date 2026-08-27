import "server-only";

import type { Actor } from "@/lib/actor";
import { withActorDb } from "@/lib/actor";
import { writeAuditLog } from "@/modules/audit/audit-service";
import {
  createBindingCode,
  maskOpenid,
} from "@/modules/miniapp/miniapp-tokens";
import {
  assertAllowed,
  assertFound,
  DomainError,
} from "@/modules/projects/errors";

const MAX_ACTIVE_CODES_PER_USER = 3;

export type MemberWechatBindingStatus = {
  membership: { id: string; role: "OWNER" | "MEMBER" };
  user: { id: string; name: string; email: string };
  binding: {
    boundAt: Date;
    lastLoginAt: Date | null;
    openidMasked: string;
  } | null;
  activeCodes: Array<{
    id: string;
    createdAt: Date;
    expiresAt: Date;
  }>;
};

type MemberContext = {
  membershipId: string;
  membershipRole: "OWNER" | "MEMBER";
  userId: string;
  userName: string;
  userEmail: string;
};

export async function getMemberWechatBindingStatus(
  actor: Actor,
  customerSpaceId: string,
  membershipId: string,
): Promise<MemberWechatBindingStatus> {
  const { member, binding, activeCodes } = await withActorDb(actor, async (tx) => {
    const member = await loadSpaceMember(tx, actor, customerSpaceId, membershipId);
    const binding = await tx.wechatBinding.findUnique({
      where: { userId: member.userId },
      select: { createdAt: true, lastLoginAt: true, openid: true },
    });
    const activeCodes = await tx.wechatBindingCode.findMany({
      where: {
        userId: member.userId,
        usedAt: null,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      select: { id: true, createdAt: true, expiresAt: true },
      orderBy: { createdAt: "desc" },
    });
    return { member, binding, activeCodes };
  });
  return {
    membership: { id: member.membershipId, role: member.membershipRole },
    user: { id: member.userId, name: member.userName, email: member.userEmail },
    binding: binding
      ? {
          boundAt: binding.createdAt,
          lastLoginAt: binding.lastLoginAt,
          openidMasked: maskOpenid(binding.openid),
        }
      : null,
    activeCodes,
  };
}

export async function createWechatBindingCode(
  actor: Actor,
  customerSpaceId: string,
  membershipId: string,
): Promise<{
  id: string;
  code: string;
  createdAt: Date;
  expiresAt: Date;
}> {
  const codeData = createBindingCode();
  return withActorDb(actor, async (tx) => {
    const member = await loadSpaceMember(tx, actor, customerSpaceId, membershipId);
    const activeCount = await tx.wechatBindingCode.count({
      where: {
        userId: member.userId,
        usedAt: null,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
    });
    if (activeCount >= MAX_ACTIVE_CODES_PER_USER) {
      throw new DomainError(
        "BINDING_CODE_LIMIT",
        "该成员已有过多未使用的绑定码，请先作废或等待过期",
        409,
      );
    }
    const created = await tx.wechatBindingCode.create({
      data: {
        userId: member.userId,
        codeHash: codeData.codeHash,
        expiresAt: codeData.expiresAt,
        createdById: actor.id,
      },
      select: { id: true, createdAt: true },
    });
    await writeAuditLog(tx, actor, {
      action: "WECHAT_BINDING_CODE_CREATED",
      resourceType: "WechatBindingCode",
      resourceId: created.id,
      customerSpaceId,
      metadata: {
        userId: member.userId,
        email: member.userEmail,
        expiresAt: codeData.expiresAt.toISOString(),
      },
    });
    return {
      id: created.id,
      code: codeData.code,
      createdAt: created.createdAt,
      expiresAt: codeData.expiresAt,
    };
  });
}

export async function revokeWechatBindingCode(
  actor: Actor,
  customerSpaceId: string,
  membershipId: string,
  codeId: string,
): Promise<void> {
  await withActorDb(actor, async (tx) => {
    const member = await loadSpaceMember(tx, actor, customerSpaceId, membershipId);
    const revoked = await tx.wechatBindingCode.updateMany({
      where: {
        id: codeId,
        userId: member.userId,
        usedAt: null,
        revokedAt: null,
      },
      data: { revokedAt: new Date() },
    });
    if (revoked.count === 0) {
      throw new DomainError(
        "NOT_FOUND",
        "待使用的绑定码不存在",
        404,
      );
    }
    await writeAuditLog(tx, actor, {
      action: "WECHAT_BINDING_CODE_REVOKED",
      resourceType: "WechatBindingCode",
      resourceId: codeId,
      customerSpaceId,
      metadata: { userId: member.userId, email: member.userEmail },
    });
  });
}

export async function removeWechatBinding(
  actor: Actor,
  customerSpaceId: string,
  membershipId: string,
): Promise<{ removedAt: Date }> {
  const removedAt = new Date();
  await withActorDb(actor, async (tx) => {
    const member = await loadSpaceMember(tx, actor, customerSpaceId, membershipId);
    const binding = await tx.wechatBinding.findUnique({
      where: { userId: member.userId },
      select: { id: true, openid: true },
    });
    assertFound(binding, "该成员尚未绑定微信");
    // 顺序必须是「先删绑定、后删会话」：删绑定会取得行锁，与登录侧的
    // issueSessionForBinding 守卫（按 openid 条件 UPDATE）串行化。
    // 若先删会话：并发登录可在会话删除之后、绑定删除之前提交，
    // 留下绑定已解除但仍有 30 天有效期的孤儿会话。
    await tx.wechatBinding.delete({ where: { id: binding.id } });
    await tx.miniappSession.deleteMany({ where: { userId: member.userId } });
    // 解除绑定即清空未使用绑定码：绑定动作只校验「账号当前未绑定」，
    // 残留的有效码可被任何持码人在 TTL 内抢先绑到刚解绑的账号上接管会话。
    const revokedPending = await tx.wechatBindingCode.updateMany({
      where: { userId: member.userId, usedAt: null, revokedAt: null },
      data: { revokedAt: removedAt },
    });
    await writeAuditLog(tx, actor, {
      action: "WECHAT_BINDING_REMOVED",
      resourceType: "WechatBinding",
      resourceId: binding.id,
      customerSpaceId,
      metadata: {
        userId: member.userId,
        email: member.userEmail,
        openid: maskOpenid(binding.openid),
        revokedBindingCodes: revokedPending.count,
      },
    });
  });
  return { removedAt };
}

/**
 * 客户在 Web 端自助解绑「自己」的微信（无需空间所有者/管理员）。
 * WechatBinding 未启用 RLS，权限靠这里只操作 userId=actor.id 来保证；
 * 删除顺序与作废语义与 removeWechatBinding 一致（含清空未使用绑定码）。
 */
export async function removeOwnWechatBinding(
  actor: Actor,
): Promise<{ removed: boolean }> {
  return withActorDb(actor, async (tx) => {
    const binding = await tx.wechatBinding.findUnique({
      where: { userId: actor.id },
      select: { id: true, openid: true },
    });
    if (!binding) return { removed: false };
    const now = new Date();
    await tx.wechatBinding.delete({ where: { id: binding.id } });
    await tx.miniappSession.deleteMany({ where: { userId: actor.id } });
    const revokedPending = await tx.wechatBindingCode.updateMany({
      where: { userId: actor.id, usedAt: null, revokedAt: null },
      data: { revokedAt: now },
    });
    await writeAuditLog(tx, actor, {
      action: "WECHAT_BINDING_REMOVED",
      resourceType: "WechatBinding",
      resourceId: binding.id,
      metadata: {
        userId: actor.id,
        self: true,
        openid: maskOpenid(binding.openid),
        revokedBindingCodes: revokedPending.count,
      },
    });
    return { removed: true };
  });
}

/**
 * 客户在 Web 端自助为「自己」生成绑定码，到小程序输入即可绑定微信。
 * 先作废本人此前未使用的绑定码，保证任一时刻只有一个有效码，也不会触达数量上限。
 *
 * 「作废旧码 + 插入新码」无法只靠行锁维持单一有效码：READ COMMITTED 下两个
 * 并发请求的 updateMany 都发生在对方插入之前，各自插入的新码互不可见，
 * 结果留下两个未撤销码。这里按用户取事务级咨询锁串行化同用户的生成请求。
 */
export async function createOwnWechatBindingCode(
  actor: Actor,
): Promise<{ code: string; expiresAt: Date }> {
  const codeData = createBindingCode();
  return withActorDb(actor, async (tx) => {
    await tx.$executeRaw`
      SELECT pg_advisory_xact_lock(hashtext(${`wechat-binding-code:${actor.id}`}))
    `;
    await tx.wechatBindingCode.updateMany({
      where: { userId: actor.id, usedAt: null, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    const created = await tx.wechatBindingCode.create({
      data: {
        userId: actor.id,
        codeHash: codeData.codeHash,
        expiresAt: codeData.expiresAt,
        createdById: actor.id,
      },
      select: { id: true },
    });
    await writeAuditLog(tx, actor, {
      action: "WECHAT_BINDING_CODE_CREATED",
      resourceType: "WechatBindingCode",
      resourceId: created.id,
      metadata: {
        userId: actor.id,
        self: true,
        expiresAt: codeData.expiresAt.toISOString(),
      },
    });
    return { code: codeData.code, expiresAt: codeData.expiresAt };
  });
}

type Tx = Parameters<Parameters<typeof withActorDb>[1]>[0];

async function loadSpaceMember(
  tx: Tx,
  actor: Actor,
  customerSpaceId: string,
  membershipId: string,
): Promise<MemberContext> {
  const space = await tx.customerSpace.findUnique({
    where: { id: customerSpaceId },
    select: {
      kind: true,
      memberships: {
        where: { userId: actor.id },
        select: { role: true },
      },
    },
  });
  assertFound(space, "客户空间不存在");
  if (space.kind !== "STANDARD") {
    throw new DomainError(
      "EXTERNAL_MANAGED_SPACE",
      "外部接入托管空间不支持客户成员与微信绑定管理",
      404,
    );
  }
  assertAllowed(
    actor.isPlatformAdmin || space.memberships[0]?.role === "OWNER",
    "仅管理员或空间所有者可以管理微信绑定",
  );
  const membership = await tx.membership.findFirst({
    where: {
      id: membershipId,
      customerSpaceId,
      user: { platformRole: "CUSTOMER", deletedAt: null },
    },
    select: {
      id: true,
      role: true,
      user: { select: { id: true, name: true, email: true } },
    },
  });
  assertFound(membership, "客户成员不存在");
  return {
    membershipId: membership.id,
    membershipRole: membership.role,
    userId: membership.user.id,
    userName: membership.user.name,
    userEmail: membership.user.email,
  };
}
