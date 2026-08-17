import "server-only";

import type { Actor } from "@/lib/actor";
import { withActorDb } from "@/lib/actor";
import {
  assertAllowed,
  assertFound,
  DomainError,
} from "@/modules/projects/errors";

// 小程序成员管理专用读取接口。
//
// 背景：/api/v1/admin/customer-spaces/:id 的 getCustomerSpace 仅靠 RLS
// app_can_access_space 校验（对空间内任意角色放行），会把全量成员邮箱、
// 他人待处理的邮箱变更申请（emailChanges.newEmail）和完整邀请列表暴露给
// 普通成员——Web 端同一功能页用的是带 assertOwnerOrAdmin 的
// getCustomerSpaceMembers。小程序原先直连 admin 路由属于越权读取。
//
// 写操作（邀请/撤销/移除）不需要此层：customer-member-service 中的
// createInvitation / revokeCustomerSpaceInvitation / removeCustomerSpaceMember
// 均自带 Owner/Admin 校验，路由直接复用。
export function getMiniappSpaceMembers(
  actor: Actor,
  customerSpaceId: string,
) {
  return withActorDb(actor, async (tx) => {
    const space = await tx.customerSpace.findUnique({
      where: { id: customerSpaceId },
      select: {
        id: true,
        name: true,
        memberLimit: true,
        ownerId: true,
        kind: true,
        memberships: {
          where: { userId: actor.id },
          select: { role: true },
        },
        _count: { select: { memberships: true } },
      },
    });
    assertFound(space, "客户空间不存在");
    if (space.kind !== "STANDARD") {
      throw new DomainError(
        "EXTERNAL_MANAGED_SPACE",
        "外部接入托管空间不支持成员管理",
        404,
      );
    }
    assertAllowed(
      actor.isPlatformAdmin || space.memberships[0]?.role === "OWNER",
      "仅客户负责人可以查看成员管理",
    );

    // 顺序执行：withActorDb 是单个 pg 连接，Promise.all 并发查询在 pg 上
    // 只是串行排队（重入警告，pg 9 起直接报错）
    const memberships = await tx.membership.findMany({
      where: { customerSpaceId },
      select: {
        id: true,
        role: true,
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            wechatBinding: { select: { createdAt: true } },
          },
        },
      },
      orderBy: { createdAt: "asc" },
    });
    const invitations = await tx.invitation.findMany({
      where: {
        customerSpaceId,
        acceptedAt: null,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      select: { id: true, email: true, expiresAt: true },
      orderBy: { createdAt: "desc" },
    });

    return {
      id: space.id,
      name: space.name,
      memberLimit: space.memberLimit,
      ownerId: space.ownerId,
      usage: space._count.memberships + invitations.length,
      memberships,
      invitations,
    };
  });
}
