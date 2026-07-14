import "server-only";

import type { Actor } from "@/lib/actor";
import { withActorDb } from "@/lib/actor";
import { getPublicAppUrl } from "@/modules/platform-settings/mail-settings-runtime";
import { enqueueMail } from "@/lib/jobs";
import { writeAuditLog } from "@/modules/audit/audit-service";
import type { CreateInvitationInput } from "@/modules/customer-spaces/schemas";
import { createInvitationToken } from "@/modules/invitations/invitation-token";
import {
  assertAllowed,
  assertFound,
  DomainError,
} from "@/modules/projects/errors";

export function listCustomerSpacesForMember(actor: Actor) {
  return withActorDb(actor, (tx) =>
    tx.membership.findMany({
      where: { userId: actor.id },
      select: {
        role: true,
        customerSpace: {
          select: {
            id: true,
            name: true,
            status: true,
            memberLimit: true,
            _count: { select: { memberships: true } },
          },
        },
      },
      orderBy: { createdAt: "asc" },
    }),
  );
}

export function getCustomerSpace(actor: Actor, customerSpaceId: string) {
  return withActorDb(actor, async (tx) => {
    const space = await tx.customerSpace.findUnique({
      where: { id: customerSpaceId },
      select: {
        id: true,
        name: true,
        slug: true,
        memberLimit: true,
        status: true,
        ownerId: true,
        createdAt: true,
        updatedAt: true,
        owner: { select: { id: true, name: true, email: true } },
        _count: {
          select: {
            memberships: true,
            projects: true,
          },
        },
        memberships: {
          select: {
            id: true,
            role: true,
            createdAt: true,
            user: {
              select: {
                id: true,
                name: true,
                email: true,
                platformRole: true,
              },
            },
          },
          orderBy: { createdAt: "asc" },
        },
        invitations: {
          select: {
            id: true,
            email: true,
            role: true,
            expiresAt: true,
            acceptedAt: true,
            revokedAt: true,
            createdAt: true,
            invitedBy: {
              select: { id: true, name: true, email: true },
            },
          },
          orderBy: { createdAt: "desc" },
        },
      },
    });
    assertFound(space, "客户空间不存在");
    assertOwnerOrAdmin(actor, space.memberships, "管理成员");
    return space;
  });
}

export function getCustomerSpaceMembers(
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
        memberships: {
          select: {
            id: true,
            role: true,
            createdAt: true,
            user: {
              select: {
                id: true,
                name: true,
                email: true,
                platformRole: true,
              },
            },
          },
          orderBy: { createdAt: "asc" },
        },
      },
    });
    assertFound(space, "客户空间不存在");
    assertOwnerOrAdmin(actor, space.memberships, "查看成员");
    return space;
  });
}

export function removeCustomerSpaceMember(
  actor: Actor,
  customerSpaceId: string,
  membershipId: string,
) {
  return withActorDb(actor, async (tx) => {
    const space = await tx.customerSpace.findUnique({
      where: { id: customerSpaceId },
      select: {
        ownerId: true,
        memberships: {
          where: { userId: actor.id },
          select: { role: true },
        },
      },
    });
    assertFound(space, "客户空间不存在");
    assertAllowed(
      actor.isPlatformAdmin || space.memberships[0]?.role === "OWNER",
      "仅管理员或空间所有者可以移除成员",
    );

    const membership = await tx.membership.findFirst({
      where: { id: membershipId, customerSpaceId },
      select: {
        id: true,
        userId: true,
        role: true,
        user: { select: { email: true } },
      },
    });
    assertFound(membership, "成员不存在");
    if (
      membership.role === "OWNER" ||
      membership.userId === space.ownerId
    ) {
      throw new DomainError(
        "OWNER_CANNOT_BE_REMOVED",
        "空间所有者不能被移除，请先变更所有者",
        409,
      );
    }

    await tx.membership.delete({ where: { id: membership.id } });
    await writeAuditLog(tx, actor, {
      action: "CUSTOMER_SPACE_MEMBER_REMOVED",
      resourceType: "Membership",
      resourceId: membership.id,
      customerSpaceId,
      metadata: {
        userId: membership.userId,
        email: membership.user.email,
      },
    });
  });
}

export async function createInvitation(
  actor: Actor,
  customerSpaceId: string,
  input: CreateInvitationInput,
) {
  const result = await withActorDb(actor, async (tx) => {
    const space = await tx.customerSpace.findUnique({
      where: { id: customerSpaceId },
      select: {
        name: true,
        status: true,
        memberLimit: true,
        memberships: {
          where: { userId: actor.id },
          select: { role: true },
        },
        _count: { select: { memberships: true } },
      },
    });
    assertFound(space, "客户空间不存在");
    assertAllowed(
      actor.isPlatformAdmin || space.memberships[0]?.role === "OWNER",
      "仅管理员或空间所有者可以邀请成员",
    );
    if (space.status !== "ACTIVE") {
      throw new DomainError(
        "SPACE_NOT_ACTIVE",
        "当前客户空间不可创建邀请",
        409,
      );
    }

    const activeInvitations = await tx.invitation.count({
      where: {
        customerSpaceId,
        acceptedAt: null,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
    });
    if (space._count.memberships + activeInvitations >= space.memberLimit) {
      throw new DomainError(
        "MEMBER_LIMIT_REACHED",
        "客户空间成员名额已满",
        409,
      );
    }

    const existingMember = await tx.membership.findFirst({
      where: { customerSpaceId, user: { email: input.email } },
      select: { id: true },
    });
    const duplicateInvitation = await tx.invitation.findFirst({
      where: {
        customerSpaceId,
        email: input.email,
        acceptedAt: null,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      select: { id: true },
    });
    if (existingMember) {
      throw new DomainError("ALREADY_MEMBER", "该邮箱已经是空间成员", 409);
    }
    if (duplicateInvitation) {
      throw new DomainError(
        "INVITATION_EXISTS",
        "该邮箱已有未过期邀请",
        409,
      );
    }

    const { token, tokenHash, expiresAt } = createInvitationToken();
    const invitation = await tx.invitation.create({
      data: {
        customerSpaceId,
        email: input.email,
        role: "MEMBER",
        expiresAt,
        invitedById: actor.id,
        tokenHash,
      },
      select: {
        id: true,
        email: true,
        role: true,
        expiresAt: true,
        createdAt: true,
      },
    });
    await writeAuditLog(tx, actor, {
      action: "CUSTOMER_SPACE_INVITATION_CREATED",
      resourceType: "Invitation",
      resourceId: invitation.id,
      customerSpaceId,
      metadata: {
        email: invitation.email,
        role: invitation.role,
        expiresAt: invitation.expiresAt.toISOString(),
      },
    });
    return { invitation, token, spaceName: space.name };
  });

  const appUrl = await getPublicAppUrl();
  const actionUrl = `${appUrl}/accept-invitation?token=${encodeURIComponent(result.token)}`;
  await enqueueMail({
    to: result.invitation.email,
    subject: `加入${result.spaceName}的客户服务空间`,
    heading: "你已被邀请加入服务支持中心",
    body: "请在 24 小时内完成账号设置，之后即可查看项目进度并提交服务请求。",
    actionLabel: "接受邀请",
    actionUrl,
  });
  return {
    ...result.invitation,
    previewUrl:
      process.env.NODE_ENV === "development" ? actionUrl : undefined,
  };
}

function assertOwnerOrAdmin(
  actor: Actor,
  memberships: Array<{ role: string; user: { id: string } }>,
  action: string,
) {
  assertAllowed(
    actor.isPlatformAdmin ||
      memberships.some(
        (membership) =>
          membership.user.id === actor.id && membership.role === "OWNER",
      ),
    `仅管理员或空间所有者可以${action}`,
  );
}
