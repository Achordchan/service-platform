import "server-only";

import type { Actor } from "@/lib/actor";
import { withActorDb } from "@/lib/actor";
import { getPublicAppUrl } from "@/modules/platform-settings/mail-settings-runtime";
import {
  assertMailDeliveryReady,
  createPreparedMailMessageInTx,
  dispatchQueuedMailMessage,
  prepareMailMessageTemplate,
} from "@/lib/jobs";
import { writeAuditLog } from "@/modules/audit/audit-service";
import { deactivateCustomerAccountIfOrphaned } from "@/modules/customer-spaces/customer-account-lifecycle";
import type {
  CreateInvitationInput,
  UpdateCustomerSpaceMemberInput,
} from "@/modules/customer-spaces/schemas";
import { createInvitationToken } from "@/modules/invitations/invitation-token";
import {
  assertAllowed,
  assertFound,
  DomainError,
} from "@/modules/projects/errors";

export function listCustomerSpacesForMember(actor: Actor) {
  return withActorDb(actor, (tx) =>
    tx.membership.findMany({
      where: {
        userId: actor.id,
        customerSpace: { kind: "STANDARD" },
      },
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
        kind: true,
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
                emailChanges: {
                  where: { status: "PENDING" },
                  orderBy: { createdAt: "desc" },
                  take: 1,
                  select: {
                    id: true,
                    newEmail: true,
                    expiresAt: true,
                    lastSentAt: true,
                  },
                },
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
    assertStandardCustomerSpace(space);
    assertOwnerOrAdmin(actor, space.memberships, "管理成员");
    const changeIds = space.memberships.flatMap((membership) =>
      membership.user.emailChanges.map((change) => change.id),
    );
    const verificationMessages =
      changeIds.length > 0
        ? await tx.mailMessage.findMany({
            where: {
              sourceType: "CUSTOMER_EMAIL_CHANGE_VERIFY",
              sourceId: { in: changeIds },
            },
            select: { sourceId: true, status: true, errorMessage: true },
            orderBy: { createdAt: "desc" },
          })
        : [];
    const latestMailByChangeId = new Map<
      string,
      { status: string; dispatchFailed: boolean }
    >();
    for (const message of verificationMessages) {
      if (message.sourceId && !latestMailByChangeId.has(message.sourceId)) {
        latestMailByChangeId.set(message.sourceId, {
          status: message.status,
          dispatchFailed:
            message.status === "QUEUED" && Boolean(message.errorMessage),
        });
      }
    }
    return {
      id: space.id,
      name: space.name,
      slug: space.slug,
      memberLimit: space.memberLimit,
      status: space.status,
      ownerId: space.ownerId,
      createdAt: space.createdAt,
      updatedAt: space.updatedAt,
      owner: space.owner,
      _count: space._count,
      memberships: space.memberships.map((membership) => ({
        ...membership,
        user: {
          ...membership.user,
          emailChanges: membership.user.emailChanges.map((change) => ({
            ...change,
            mailStatus: latestMailByChangeId.get(change.id)?.status ?? null,
            mailDispatchFailed:
              latestMailByChangeId.get(change.id)?.dispatchFailed ?? false,
          })),
        },
      })),
      invitations: space.invitations,
    };
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
        kind: true,
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
    assertStandardCustomerSpace(space);
    assertOwnerOrAdmin(actor, space.memberships, "查看成员");
    return {
      id: space.id,
      name: space.name,
      memberLimit: space.memberLimit,
      memberships: space.memberships,
    };
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
        kind: true,
        ownerId: true,
        memberships: {
          where: { userId: actor.id },
          select: { role: true },
        },
      },
    });
    assertStandardCustomerSpace(space);
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
    const accountDeleted = await deactivateCustomerAccountIfOrphaned(
      tx,
      actor,
      membership.userId,
      { sourceCustomerSpaceId: customerSpaceId },
    );
    await writeAuditLog(tx, actor, {
      action: "CUSTOMER_SPACE_MEMBER_REMOVED",
      resourceType: "Membership",
      resourceId: membership.id,
      customerSpaceId,
      metadata: {
        userId: membership.userId,
        email: membership.user.email,
        accountDeleted,
      },
    });
    return { accountDeleted };
  });
}

export function updateCustomerSpaceMember(
  actor: Actor,
  customerSpaceId: string,
  membershipId: string,
  input: UpdateCustomerSpaceMemberInput,
) {
  assertAllowed(actor.isPlatformAdmin, "仅平台管理员可以编辑客户账号");
  return withActorDb(actor, async (tx) => {
    const membership = await tx.membership.findFirst({
      where: {
        id: membershipId,
        customerSpaceId,
        customerSpace: { kind: "STANDARD" },
        user: { platformRole: "CUSTOMER", deletedAt: null },
      },
      select: {
        id: true,
        userId: true,
        user: { select: { name: true, email: true } },
      },
    });
    assertFound(membership, "客户账号不存在");
    const updated = await tx.user.update({
      where: { id: membership.userId },
      data: { name: input.name },
      select: { id: true, name: true, email: true },
    });
    await writeAuditLog(tx, actor, {
      action: "CUSTOMER_ACCOUNT_UPDATED",
      resourceType: "User",
      resourceId: updated.id,
      customerSpaceId,
      metadata: {
        previousName: membership.user.name,
        name: updated.name,
        email: updated.email,
      },
    });
    return updated;
  });
}

export async function createInvitation(
  actor: Actor,
  customerSpaceId: string,
  input: CreateInvitationInput,
) {
  await assertMailDeliveryReady();
  const appUrl = await getPublicAppUrl();
  const tokenData = createInvitationToken();
  const actionUrl = `${appUrl}/accept-invitation?token=${encodeURIComponent(tokenData.token)}`;
  const templateSpace = await withActorDb(actor, (tx) =>
    tx.customerSpace.findUnique({
      where: { id: customerSpaceId },
      select: {
        name: true,
        kind: true,
        memberships: {
          where: { userId: actor.id },
          select: { role: true },
        },
      },
    }),
  );
  assertStandardCustomerSpace(templateSpace);
  assertAllowed(
    actor.isPlatformAdmin || templateSpace.memberships[0]?.role === "OWNER",
    "仅管理员或空间所有者可以邀请成员",
  );
  const mailInput = {
    to: input.email,
    templateKey: "CUSTOMER_MEMBER_INVITATION" as const,
    variables: {
      recipientEmail: input.email,
      inviterName: actor.name,
      inviterEmail: actor.email,
      customerName: templateSpace.name,
      spaceName: templateSpace.name,
      expiresIn: "24 小时",
    },
    actionUrl,
  };
  const preparedTemplate = await prepareMailMessageTemplate(mailInput);
  const result = await withActorDb(actor, async (tx) => {
    const space = await tx.customerSpace.findUnique({
      where: { id: customerSpaceId },
      select: {
        name: true,
        kind: true,
        status: true,
        memberLimit: true,
        memberships: {
          where: { userId: actor.id },
          select: { role: true },
        },
        _count: { select: { memberships: true } },
      },
    });
    assertStandardCustomerSpace(space);
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
    const assignedCustomer = await tx.user.findUnique({
      where: { email: input.email },
      select: {
        platformRole: true,
        deletedAt: true,
        memberships: {
          where: {
            customerSpace: { kind: "STANDARD" },
            customerSpaceId: { not: customerSpaceId },
          },
          select: { id: true },
          take: 1,
        },
      },
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
    if (
      assignedCustomer &&
      (assignedCustomer.platformRole !== "CUSTOMER" || assignedCustomer.deletedAt)
    ) {
      throw new DomainError(
        "CUSTOMER_EMAIL_UNAVAILABLE",
        "该邮箱不能用于客户成员账号",
        409,
      );
    }
    if (assignedCustomer?.memberships.length) {
      throw new DomainError(
        "CUSTOMER_ACCOUNT_ALREADY_ASSIGNED",
        "该客户账号已属于其他客户，请使用新的邮箱",
        409,
      );
    }
    if (duplicateInvitation) {
      throw new DomainError(
        "INVITATION_EXISTS",
        "该邮箱已有未过期邀请",
        409,
      );
    }

    const invitation = await tx.invitation.create({
      data: {
        customerSpaceId,
        email: input.email,
        role: "MEMBER",
        expiresAt: tokenData.expiresAt,
        invitedById: actor.id,
        tokenHash: tokenData.tokenHash,
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
    const mailMessage = await createPreparedMailMessageInTx(tx, {
      ...mailInput,
      to: invitation.email,
      variables: {
        ...mailInput.variables,
        recipientEmail: invitation.email,
        customerName: space.name,
        spaceName: space.name,
      },
      idempotencyKey: `customer-member-invitation:${invitation.id}`,
      sourceType: "CUSTOMER_MEMBER_INVITATION",
      sourceId: invitation.id,
    }, preparedTemplate);
    return { invitation, mailMessage };
  });

  await dispatchQueuedMailMessage(
    result.mailMessage.id,
    result.mailMessage.deliveryMode,
    result.mailMessage.sendAfter,
  );
  return {
    ...result.invitation,
    previewUrl:
      process.env.NODE_ENV === "development" ? actionUrl : undefined,
  };
}

export function revokeCustomerSpaceInvitation(
  actor: Actor,
  customerSpaceId: string,
  invitationId: string,
) {
  return withActorDb(actor, async (tx) => {
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
    assertStandardCustomerSpace(space);
    assertAllowed(
      actor.isPlatformAdmin || space.memberships[0]?.role === "OWNER",
      "仅管理员或空间所有者可以撤销邀请",
    );
    const invitation = await tx.invitation.findFirst({
      where: {
        id: invitationId,
        customerSpaceId,
        acceptedAt: null,
        revokedAt: null,
      },
      select: { id: true, email: true },
    });
    assertFound(invitation, "待处理邀请不存在");
    await tx.invitation.update({
      where: { id: invitation.id },
      data: { revokedAt: new Date() },
    });
    await tx.mailMessage.updateMany({
      where: {
        sourceType: {
          in: ["CUSTOMER_OWNER_INVITATION", "CUSTOMER_MEMBER_INVITATION"],
        },
        sourceId: invitation.id,
        status: { in: ["QUEUED", "PROCESSING"] },
      },
      data: {
        status: "CANCELLED",
        errorMessage: "客户邀请已撤销",
      },
    });
    await writeAuditLog(tx, actor, {
      action: "CUSTOMER_SPACE_INVITATION_REVOKED",
      resourceType: "Invitation",
      resourceId: invitation.id,
      customerSpaceId,
      metadata: { email: invitation.email },
    });
  });
}


function assertStandardCustomerSpace<T extends { kind?: string | null }>(
  space: T | null | undefined,
): asserts space is T & { kind: "STANDARD" } {
  assertFound(space, "客户空间不存在");
  if (space.kind !== "STANDARD") {
    throw new DomainError(
      "EXTERNAL_MANAGED_SPACE",
      "外部接入托管空间不支持客户成员与邀请管理",
      404,
    );
  }
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
