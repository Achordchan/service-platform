import "server-only";

import type { Actor } from "@/lib/actor";
import { withActorDb } from "@/lib/actor";
import { getPublicAppUrl } from "@/modules/platform-settings/mail-settings-runtime";
import { enqueueMail } from "@/lib/jobs";
import { writeAuditLog } from "@/modules/audit/audit-service";
import { createInvitationToken } from "@/modules/invitations/invitation-token";
import {
  assertAllowed,
  assertFound,
  DomainError,
} from "@/modules/projects/errors";
import type {
  CreateCustomerSpaceInput,
  UpdateCustomerSpaceInput,
} from "@/modules/customer-spaces/schemas";
import {
  buildSpaceSlug,
  nextSlugCandidate,
} from "@/modules/customer-spaces/slug";

const spaceSelect = {
  id: true,
  name: true,
  slug: true,
  memberLimit: true,
  status: true,
  ownerId: true,
  createdAt: true,
  updatedAt: true,
  owner: {
    select: {
      id: true,
      name: true,
      email: true,
    },
  },
  _count: {
    select: {
      memberships: true,
      projects: true,
    },
  },
} as const;

export function listCustomerSpaces(actor: Actor) {
  assertAllowed(actor.isPlatformAdmin);
  return withActorDb(actor, (tx) =>
    tx.customerSpace.findMany({
      select: spaceSelect,
      orderBy: { createdAt: "desc" },
    }),
  );
}

export async function createCustomerSpace(
  actor: Actor,
  input: CreateCustomerSpaceInput,
) {
  assertAllowed(actor.isPlatformAdmin);
  const result = await withActorDb(actor, async (tx) => {
    const baseSlug = buildSpaceSlug(input.name, input.slug);
    let slug = baseSlug;
    for (let attempt = 1; attempt <= 20; attempt += 1) {
      slug = nextSlugCandidate(baseSlug, attempt);
      const duplicate = await tx.customerSpace.findUnique({
        where: { slug },
        select: { id: true },
      });
      if (!duplicate) break;
      if (attempt === 20) {
        throw new DomainError("SLUG_CONFLICT", "空间标识生成失败，请手动指定", 409);
      }
    }

    let owner: { id: string; name: string; email: string };
    let invitation:
      | {
          id: string;
          email: string;
          expiresAt: Date;
          token: string;
        }
      | undefined;

    if (input.ownerId) {
      const existingOwner = await tx.user.findUnique({
        where: { id: input.ownerId },
        select: {
          id: true,
          name: true,
          email: true,
          platformRole: true,
        },
      });
      assertFound(existingOwner, "空间所有者不存在");
      if (existingOwner.platformRole !== "CUSTOMER") {
        throw new DomainError(
          "INVALID_SPACE_OWNER",
          "客户空间所有者必须是客户账号",
          409,
        );
      }
      owner = existingOwner;
    } else {
      const ownerEmail = input.ownerEmail!;
      const ownerName = input.ownerName!;
      const existingOwner = await tx.user.findUnique({
        where: { email: ownerEmail },
        select: {
          id: true,
          name: true,
          email: true,
          platformRole: true,
        },
      });
      if (existingOwner && existingOwner.platformRole !== "CUSTOMER") {
        throw new DomainError(
          "OWNER_EMAIL_IN_USE",
          "该邮箱已被内部工作人员使用",
          409,
        );
      }
      owner =
        existingOwner ??
        (await tx.user.create({
          data: {
            name: ownerName,
            email: ownerEmail,
            platformRole: "CUSTOMER",
            emailVerified: false,
          },
          select: { id: true, name: true, email: true },
        }));
    }

    const space = await tx.customerSpace.create({
      data: {
        name: input.name,
        slug,
        memberLimit: input.memberLimit,
        status: input.status,
        ownerId: owner.id,
        memberships: {
          create: {
            userId: owner.id,
            role: "OWNER",
          },
        },
      },
      select: spaceSelect,
    });

    if (!input.ownerId) {
      const tokenData = createInvitationToken();
      const createdInvitation = await tx.invitation.create({
        data: {
          customerSpaceId: space.id,
          email: owner.email,
          role: "OWNER",
          expiresAt: tokenData.expiresAt,
          invitedById: actor.id,
          tokenHash: tokenData.tokenHash,
        },
        select: {
          id: true,
          email: true,
          expiresAt: true,
        },
      });
      invitation = {
        ...createdInvitation,
        token: tokenData.token,
      };
    }

    await writeAuditLog(tx, actor, {
      action: "CUSTOMER_SPACE_CREATED",
      resourceType: "CustomerSpace",
      resourceId: space.id,
      customerSpaceId: space.id,
      metadata: {
        name: space.name,
        slug: space.slug,
        ownerId: space.ownerId,
        ownerInvitationId: invitation?.id,
      },
    });
    return { space, invitation };
  });

  if (!result.invitation) {
    return result.space;
  }

  const appUrl = await getPublicAppUrl();
  const actionUrl = `${appUrl}/accept-invitation?token=${encodeURIComponent(result.invitation.token)}`;
  await enqueueMail({
    to: result.invitation.email,
    templateKey: "CUSTOMER_OWNER_INVITATION",
    variables: {
      recipientName: result.space.owner.name,
      recipientEmail: result.space.owner.email,
      inviterName: actor.name,
      inviterEmail: actor.email,
      customerName: result.space.name,
      spaceName: result.space.name,
      expiresIn: "24 小时",
    },
    actionUrl,
  });

  return {
    ...result.space,
    previewUrl:
      process.env.NODE_ENV === "development" ? actionUrl : undefined,
  };
}

export function updateCustomerSpace(
  actor: Actor,
  customerSpaceId: string,
  input: UpdateCustomerSpaceInput,
) {
  assertAllowed(actor.isPlatformAdmin);
  return withActorDb(actor, async (tx) => {
    const existing = await tx.customerSpace.findUnique({
      where: { id: customerSpaceId },
      select: {
        id: true,
        slug: true,
        ownerId: true,
        memberLimit: true,
        _count: { select: { memberships: true } },
      },
    });
    assertFound(existing, "客户空间不存在");

    if (
      input.memberLimit !== undefined &&
      input.memberLimit < existing._count.memberships
    ) {
      throw new DomainError(
        "MEMBER_LIMIT_TOO_SMALL",
        "成员上限不能小于当前成员数",
        409,
      );
    }

    if (input.slug && input.slug !== existing.slug) {
      const duplicate = await tx.customerSpace.findUnique({
        where: { slug: input.slug },
        select: { id: true },
      });
      if (duplicate) {
        throw new DomainError("SLUG_CONFLICT", "空间标识已被使用", 409);
      }
    }

    if (input.ownerId && input.ownerId !== existing.ownerId) {
      const newOwner = await tx.user.findUnique({
        where: { id: input.ownerId },
        select: { id: true, platformRole: true },
      });
      const existingMembership = await tx.membership.findUnique({
        where: {
          customerSpaceId_userId: {
            customerSpaceId,
            userId: input.ownerId,
          },
        },
        select: { id: true },
      });
      assertFound(newOwner, "新的空间所有者不存在");
      if (newOwner.platformRole !== "CUSTOMER") {
        throw new DomainError(
          "INVALID_SPACE_OWNER",
          "客户空间所有者必须是客户账号",
          409,
        );
      }
      const effectiveLimit = input.memberLimit ?? existing.memberLimit;
      if (
        !existingMembership &&
        existing._count.memberships >= effectiveLimit
      ) {
        throw new DomainError(
          "MEMBER_LIMIT_REACHED",
          "成员上限不足以完成所有者变更",
          409,
        );
      }

      await tx.membership.updateMany({
        where: {
          customerSpaceId,
          userId: existing.ownerId,
          role: "OWNER",
        },
        data: { role: "MEMBER" },
      });
      await tx.membership.upsert({
        where: {
          customerSpaceId_userId: {
            customerSpaceId,
            userId: input.ownerId,
          },
        },
        create: {
          customerSpaceId,
          userId: input.ownerId,
          role: "OWNER",
        },
        update: { role: "OWNER" },
      });
    }

    const space = await tx.customerSpace.update({
      where: { id: customerSpaceId },
      data: input,
      select: spaceSelect,
    });
    await writeAuditLog(tx, actor, {
      action: "CUSTOMER_SPACE_UPDATED",
      resourceType: "CustomerSpace",
      resourceId: space.id,
      customerSpaceId: space.id,
      metadata: input,
    });
    return space;
  });
}

export function deleteCustomerSpace(actor: Actor, customerSpaceId: string) {
  assertAllowed(actor.isPlatformAdmin);
  return withActorDb(actor, async (tx) => {
    const existing = await tx.customerSpace.findUnique({
      where: { id: customerSpaceId },
      select: {
        id: true,
        name: true,
        _count: {
          select: {
            projects: true,
            memberships: true,
          },
        },
      },
    });
    assertFound(existing, "客户空间不存在");

    if (existing._count.projects > 0) {
      throw new DomainError(
        "CUSTOMER_SPACE_HAS_PROJECTS",
        "客户空间下仍有项目，请先删除或转移项目后再删除",
        409,
      );
    }

    await tx.invitation.deleteMany({ where: { customerSpaceId } });
    await tx.membership.deleteMany({ where: { customerSpaceId } });
    await tx.customerSpace.delete({ where: { id: customerSpaceId } });
    await writeAuditLog(tx, actor, {
      action: "CUSTOMER_SPACE_DELETED",
      resourceType: "CustomerSpace",
      resourceId: existing.id,
      customerSpaceId: existing.id,
      metadata: {
        name: existing.name,
        membershipCount: existing._count.memberships,
      },
    });
  });
}
