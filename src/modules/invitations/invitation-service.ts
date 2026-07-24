import "server-only";

import { hashPassword } from "better-auth/crypto";
import { z } from "zod";
import { withSystemDb } from "@/lib/actor";
import { writeAuditLog } from "@/modules/audit/audit-service";
import { hashInvitationToken } from "@/modules/invitations/invitation-token";
import {
  acceptStaffInvitation,
  getStaffInvitationPreview,
} from "@/modules/users/staff-invitation-service";

const acceptInvitationSchema = z.object({
  token: z.string().min(32),
  name: z.string().trim().min(2).max(60),
  password: z.string().min(10).max(128),
});

export async function getInvitationPreview(token: string) {
  if (!token || token.length < 32) return null;

  const staffPreview = await getStaffInvitationPreview(token);
  if (staffPreview) return staffPreview;

  return withSystemDb(async (tx) => {
    const invitation = await tx.invitation.findUnique({
      where: { tokenHash: hashInvitationToken(token) },
      select: {
        email: true,
        role: true,
        expiresAt: true,
        acceptedAt: true,
        revokedAt: true,
        customerSpace: {
          select: {
            name: true,
            slug: true,
            kind: true,
          },
        },
      },
    });
    if (
      !invitation ||
      invitation.acceptedAt ||
      invitation.revokedAt ||
      invitation.expiresAt <= new Date() ||
      invitation.customerSpace.kind !== "STANDARD"
    ) {
      return null;
    }

    const existingUser = await tx.user.findUnique({
      where: { email: invitation.email },
      select: { name: true },
    });

    return {
      kind: "customer" as const,
      email: invitation.email,
      role: invitation.role,
      roleLabel: invitation.role === "OWNER" ? "空间所有者" : "成员",
      expiresAt: invitation.expiresAt.toISOString(),
      spaceName: invitation.customerSpace.name,
      spaceSlug: invitation.customerSpace.slug,
      nameHint: existingUser?.name ?? "",
    };
  });
}

export async function acceptInvitation(
  input: z.input<typeof acceptInvitationSchema>,
) {
  const data = acceptInvitationSchema.parse(input);

  const staffPreview = await getStaffInvitationPreview(data.token);
  if (staffPreview) {
    return acceptStaffInvitation(data);
  }

  return withSystemDb(async (tx) => {
    const now = new Date();
    const invitation = await tx.invitation.findUnique({
      where: { tokenHash: hashInvitationToken(data.token) },
      include: {
        customerSpace: {
          include: { _count: { select: { memberships: true } } },
        },
      },
    });

    if (
      !invitation ||
      invitation.acceptedAt ||
      invitation.revokedAt ||
      invitation.expiresAt <= now ||
      invitation.customerSpace.kind !== "STANDARD"
    ) {
      throw new Error("INVITATION_INVALID");
    }

    let user = await tx.user.findUnique({
      where: { email: invitation.email },
      include: {
        accounts: true,
        memberships: {
          where: { customerSpace: { kind: "STANDARD" } },
          select: { customerSpaceId: true },
        },
      },
    });
    if (user && (user.platformRole !== "CUSTOMER" || user.deletedAt)) {
      throw new Error("INVITATION_INVALID");
    }
    if (
      user?.memberships.some(
        (membership) =>
          membership.customerSpaceId !== invitation.customerSpaceId,
      )
    ) {
      throw new Error("CUSTOMER_ACCOUNT_ALREADY_ASSIGNED");
    }

    const existingMembership = user
      ? await tx.membership.findUnique({
          where: {
            customerSpaceId_userId: {
              customerSpaceId: invitation.customerSpaceId,
              userId: user.id,
            },
          },
          select: { id: true },
        })
      : null;
    if (
      !existingMembership &&
      invitation.customerSpace._count.memberships >=
        invitation.customerSpace.memberLimit
    ) {
      throw new Error("MEMBER_LIMIT_REACHED");
    }

    const claimedInvitation = await tx.invitation.updateMany({
      where: {
        id: invitation.id,
        acceptedAt: null,
        revokedAt: null,
        expiresAt: { gt: now },
      },
      data: { acceptedAt: now },
    });
    if (claimedInvitation.count !== 1) {
      throw new Error("INVITATION_INVALID");
    }

    let accountExists = Boolean(
      user?.accounts.some((account) => account.providerId === "credential"),
    );

    if (!user) {
      const password = await hashPassword(data.password);
      user = await tx.user.create({
        data: {
          name: data.name,
          email: invitation.email,
          emailVerified: true,
          platformRole: "CUSTOMER",
        },
        include: {
          accounts: true,
          memberships: {
            where: { customerSpace: { kind: "STANDARD" } },
            select: { customerSpaceId: true },
          },
        },
      });
      await tx.account.create({
        data: {
          accountId: user.id,
          providerId: "credential",
          userId: user.id,
          password,
        },
      });
      accountExists = false;
    } else if (!accountExists) {
      const password = await hashPassword(data.password);
      await tx.account.create({
        data: {
          accountId: user.id,
          providerId: "credential",
          userId: user.id,
          password,
        },
      });
      await tx.user.update({
        where: { id: user.id },
        data: { name: data.name, emailVerified: true },
      });
      accountExists = false;
    }

    if (!user) throw new Error("INVITATION_INVALID");
    const acceptedUser = user;

    await tx.membership.upsert({
      where: {
        customerSpaceId_userId: {
          customerSpaceId: invitation.customerSpaceId,
          userId: acceptedUser.id,
        },
      },
      update: {},
      create: {
        customerSpaceId: invitation.customerSpaceId,
        userId: acceptedUser.id,
        role: invitation.role,
      },
    });
    await writeAuditLog(
      tx,
      {
        id: "system",
        name: "系统",
        email: "system@local",
        platformRole: "PLATFORM_ADMIN",
        isPlatformAdmin: true,
        isStaff: true,
      },
      {
        action: "CUSTOMER_SPACE_INVITATION_ACCEPTED",
        resourceType: "Invitation",
        resourceId: invitation.id,
        customerSpaceId: invitation.customerSpaceId,
        metadata: {
          email: invitation.email,
          userId: acceptedUser.id,
        },
      },
    );

    return {
      accountExists,
      email: invitation.email,
      spaceName: invitation.customerSpace.name,
    };
  });
}
