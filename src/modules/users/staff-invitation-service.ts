import "server-only";

import { hashPassword } from "better-auth/crypto";
import { z } from "zod";
import type { Actor } from "@/lib/actor";
import { withActorDb, withSystemDb } from "@/lib/actor";
import { enqueueMail } from "@/lib/jobs";
import { writeAuditLog } from "@/modules/audit/audit-service";
import {
  createInvitationToken,
  hashInvitationToken,
} from "@/modules/invitations/invitation-token";
import { getPublicAppUrl } from "@/modules/platform-settings/mail-settings-runtime";
import {
  assertAllowed,
  assertFound,
  DomainError,
} from "@/modules/projects/errors";

const contactFields = {
  phone: z.string().trim().max(40).optional().or(z.literal("")),
  company: z.string().trim().max(120).optional().or(z.literal("")),
  jobTitle: z.string().trim().max(80).optional().or(z.literal("")),
  wechat: z.string().trim().max(80).optional().or(z.literal("")),
  website: z.string().trim().max(200).optional().or(z.literal("")),
  location: z.string().trim().max(120).optional().or(z.literal("")),
  contactNotes: z.string().trim().max(500).optional().or(z.literal("")),
};

const inviteStaffSchema = z.object({
  email: z.string().trim().email().max(160),
  name: z.string().trim().min(2).max(60),
  roleGroupId: z.string().min(1),
  ...contactFields,
});

const acceptStaffInvitationSchema = z.object({
  token: z.string().min(32),
  name: z.string().trim().min(2).max(60),
  password: z.string().min(10).max(128),
});

const updateStaffProfileSchema = z.object({
  name: z.string().trim().min(2).max(60).optional(),
  roleGroupId: z.string().min(1).optional().nullable(),
  ...contactFields,
});

export type InviteStaffInput = z.infer<typeof inviteStaffSchema>;
export type UpdateStaffProfileInput = z.infer<typeof updateStaffProfileSchema>;

function emptyToNull(value?: string | null) {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function profileData(input: {
  phone?: string | null;
  company?: string | null;
  jobTitle?: string | null;
  wechat?: string | null;
  website?: string | null;
  location?: string | null;
  contactNotes?: string | null;
}) {
  return {
    phone: emptyToNull(input.phone),
    company: emptyToNull(input.company),
    jobTitle: emptyToNull(input.jobTitle),
    wechat: emptyToNull(input.wechat),
    website: emptyToNull(input.website),
    location: emptyToNull(input.location),
    contactNotes: emptyToNull(input.contactNotes),
  };
}

export function listInternalUsers(actor: Actor) {
  assertAllowed(actor.isPlatformAdmin);
  return withActorDb(actor, (tx) =>
    tx.user.findMany({
      where: {
        platformRole: {
          in: ["PLATFORM_ADMIN", "PROJECT_MANAGER", "TECHNICIAN"],
        },
      },
      select: {
        id: true,
        name: true,
        email: true,
        platformRole: true,
        emailVerified: true,
        phone: true,
        company: true,
        jobTitle: true,
        wechat: true,
        website: true,
        location: true,
        contactNotes: true,
        roleGroupId: true,
        createdAt: true,
        roleGroup: {
          select: {
            id: true,
            name: true,
            accessLevel: true,
            active: true,
          },
        },
        _count: {
          select: {
            projectAssignments: true,
          },
        },
      },
      orderBy: [{ platformRole: "asc" }, { createdAt: "desc" }],
    }),
  );
}

export function listStaffInvitations(actor: Actor) {
  assertAllowed(actor.isPlatformAdmin);
  return withActorDb(actor, (tx) =>
    tx.staffInvitation.findMany({
      where: {
        acceptedAt: null,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      include: {
        invitedBy: {
          select: { id: true, name: true, email: true },
        },
        roleGroup: {
          select: {
            id: true,
            name: true,
            accessLevel: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
  );
}

export async function inviteStaff(actor: Actor, raw: InviteStaffInput) {
  assertAllowed(actor.isPlatformAdmin);
  const input = inviteStaffSchema.parse(raw);
  const email = input.email.toLowerCase();
  const tokenData = createInvitationToken();
  const profile = profileData(input);

  const result = await withActorDb(actor, async (tx) => {
    const roleGroup = await tx.roleGroup.findUnique({
      where: { id: input.roleGroupId },
    });
    assertFound(roleGroup, "角色组不存在");
    if (!roleGroup.active) {
      throw new DomainError("ROLE_GROUP_INACTIVE", "该角色组已停用", 409);
    }

    const existingUser = await tx.user.findUnique({
      where: { email },
      select: {
        id: true,
        name: true,
        platformRole: true,
      },
    });

    if (existingUser) {
      if (existingUser.platformRole === "CUSTOMER") {
        throw new DomainError(
          "STAFF_EMAIL_IS_CUSTOMER",
          "该邮箱已是客户账号，请换一个邮箱邀请内部/外包人员",
          409,
        );
      }
      throw new DomainError(
        "STAFF_ALREADY_EXISTS",
        "该邮箱已经是内部人员，可直接在项目中分配",
        409,
      );
    }

    await tx.staffInvitation.updateMany({
      where: {
        email,
        acceptedAt: null,
        revokedAt: null,
      },
      data: { revokedAt: new Date() },
    });

    const invitation = await tx.staffInvitation.create({
      data: {
        email,
        name: input.name,
        ...profile,
        platformRole: roleGroup.accessLevel,
        roleGroupId: roleGroup.id,
        expiresAt: tokenData.expiresAt,
        tokenHash: tokenData.tokenHash,
        invitedById: actor.id,
      },
      include: {
        invitedBy: {
          select: { id: true, name: true, email: true },
        },
        roleGroup: {
          select: {
            id: true,
            name: true,
            accessLevel: true,
          },
        },
      },
    });

    await writeAuditLog(tx, actor, {
      action: "STAFF_INVITATION_CREATED",
      resourceType: "StaffInvitation",
      resourceId: invitation.id,
      metadata: {
        email,
        roleGroupId: roleGroup.id,
        platformRole: roleGroup.accessLevel,
      },
    });

    return {
      invitation,
      token: tokenData.token,
      roleGroupName: roleGroup.name,
    };
  });

  const appUrl = await getPublicAppUrl();
  const actionUrl = `${appUrl}/accept-invitation?token=${encodeURIComponent(result.token)}`;

  await enqueueMail({
    to: email,
    subject: `邀请你加入服务支持协作：${result.roleGroupName}`,
    heading: "欢迎加入协作团队",
    body: `你已被邀请以「${result.roleGroupName}」身份加入服务支持中心。请在 24 小时内设置账号密码，之后可登录后台处理被授权的项目与服务请求。`,
    actionLabel: "设置账号并加入",
    actionUrl,
  });

  return {
    ...result.invitation,
    previewUrl:
      process.env.NODE_ENV === "development" ? actionUrl : undefined,
  };
}

export function revokeStaffInvitation(actor: Actor, invitationId: string) {
  assertAllowed(actor.isPlatformAdmin);
  return withActorDb(actor, async (tx) => {
    const invitation = await tx.staffInvitation.findUnique({
      where: { id: invitationId },
      select: { id: true, acceptedAt: true, revokedAt: true },
    });
    assertFound(invitation, "邀请不存在");
    if (invitation.acceptedAt) {
      throw new DomainError(
        "STAFF_INVITATION_ALREADY_ACCEPTED",
        "邀请已被接受，无法撤销",
        409,
      );
    }
    if (invitation.revokedAt) {
      return invitation;
    }

    const updated = await tx.staffInvitation.update({
      where: { id: invitationId },
      data: { revokedAt: new Date() },
    });
    await writeAuditLog(tx, actor, {
      action: "STAFF_INVITATION_REVOKED",
      resourceType: "StaffInvitation",
      resourceId: invitationId,
    });
    return updated;
  });
}

export function updateStaffProfile(
  actor: Actor,
  userId: string,
  raw: UpdateStaffProfileInput,
) {
  assertAllowed(actor.isPlatformAdmin);
  const input = updateStaffProfileSchema.parse(raw);

  return withActorDb(actor, async (tx) => {
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        platformRole: true,
        roleGroupId: true,
      },
    });
    assertFound(user, "用户不存在");
    if (user.platformRole === "CUSTOMER") {
      throw new DomainError(
        "NOT_INTERNAL_USER",
        "只能维护内部/外包协作人员资料",
        409,
      );
    }
    if (user.platformRole === "PLATFORM_ADMIN" && input.roleGroupId) {
      throw new DomainError(
        "ADMIN_ROLE_GROUP_LOCKED",
        "平台管理员不绑定协作角色组",
        409,
      );
    }

    let nextPlatformRole = user.platformRole;
    let nextRoleGroupId =
      input.roleGroupId === undefined ? user.roleGroupId : input.roleGroupId;

    if (input.roleGroupId) {
      const roleGroup = await tx.roleGroup.findUnique({
        where: { id: input.roleGroupId },
      });
      assertFound(roleGroup, "角色组不存在");
      if (!roleGroup.active) {
        throw new DomainError("ROLE_GROUP_INACTIVE", "该角色组已停用", 409);
      }
      nextPlatformRole = roleGroup.accessLevel;
      nextRoleGroupId = roleGroup.id;
    }

    const updated = await tx.user.update({
      where: { id: userId },
      data: {
        name: input.name?.trim() || undefined,
        platformRole:
          user.platformRole === "PLATFORM_ADMIN"
            ? undefined
            : nextPlatformRole,
        roleGroupId:
          user.platformRole === "PLATFORM_ADMIN" ? null : nextRoleGroupId,
        ...profileData(input),
      },
      include: {
        roleGroup: {
          select: {
            id: true,
            name: true,
            accessLevel: true,
            active: true,
          },
        },
        _count: {
          select: { projectAssignments: true },
        },
      },
    });

    await writeAuditLog(tx, actor, {
      action: "STAFF_PROFILE_UPDATED",
      resourceType: "User",
      resourceId: userId,
      metadata: {
        roleGroupId: updated.roleGroupId,
        platformRole: updated.platformRole,
      },
    });

    return updated;
  });
}

export async function getStaffInvitationPreview(token: string) {
  if (!token || token.length < 32) return null;
  return withSystemDb(async (tx) => {
    const invitation = await tx.staffInvitation.findUnique({
      where: { tokenHash: hashInvitationToken(token) },
      select: {
        email: true,
        name: true,
        platformRole: true,
        company: true,
        jobTitle: true,
        expiresAt: true,
        acceptedAt: true,
        revokedAt: true,
        roleGroup: {
          select: {
            name: true,
            accessLevel: true,
          },
        },
      },
    });
    if (
      !invitation ||
      invitation.acceptedAt ||
      invitation.revokedAt ||
      invitation.expiresAt <= new Date()
    ) {
      return null;
    }
    if (
      invitation.platformRole !== "PROJECT_MANAGER" &&
      invitation.platformRole !== "TECHNICIAN"
    ) {
      return null;
    }

    const roleLabel =
      invitation.roleGroup?.name ||
      (invitation.platformRole === "PROJECT_MANAGER"
        ? "项目负责人"
        : "技术人员");

    return {
      kind: "staff" as const,
      email: invitation.email,
      role: invitation.platformRole,
      roleLabel,
      company: invitation.company,
      jobTitle: invitation.jobTitle,
      expiresAt: invitation.expiresAt.toISOString(),
      spaceName: "服务支持协作团队",
      nameHint: invitation.name ?? "",
    };
  });
}

export async function acceptStaffInvitation(
  input: z.input<typeof acceptStaffInvitationSchema>,
) {
  const data = acceptStaffInvitationSchema.parse(input);

  return withSystemDb(async (tx) => {
    const now = new Date();
    const invitation = await tx.staffInvitation.findUnique({
      where: { tokenHash: hashInvitationToken(data.token) },
      include: {
        roleGroup: {
          select: {
            id: true,
            name: true,
            accessLevel: true,
            active: true,
          },
        },
      },
    });

    if (
      !invitation ||
      invitation.acceptedAt ||
      invitation.revokedAt ||
      invitation.expiresAt <= now
    ) {
      throw new Error("INVITATION_INVALID");
    }

    if (
      invitation.platformRole !== "PROJECT_MANAGER" &&
      invitation.platformRole !== "TECHNICIAN"
    ) {
      throw new Error("INVITATION_INVALID");
    }

    const existingUser = await tx.user.findUnique({
      where: { email: invitation.email },
    });
    if (existingUser) {
      throw new Error("INVITATION_INVALID");
    }

    const claimed = await tx.staffInvitation.updateMany({
      where: {
        id: invitation.id,
        acceptedAt: null,
        revokedAt: null,
        expiresAt: { gt: now },
      },
      data: { acceptedAt: now },
    });
    if (claimed.count !== 1) {
      throw new Error("INVITATION_INVALID");
    }

    const password = await hashPassword(data.password);
    const user = await tx.user.create({
      data: {
        name: data.name,
        email: invitation.email,
        emailVerified: true,
        platformRole: invitation.platformRole,
        roleGroupId: invitation.roleGroupId,
        phone: invitation.phone,
        company: invitation.company,
        jobTitle: invitation.jobTitle,
        wechat: invitation.wechat,
        website: invitation.website,
        location: invitation.location,
        contactNotes: invitation.contactNotes,
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
        action: "STAFF_INVITATION_ACCEPTED",
        resourceType: "StaffInvitation",
        resourceId: invitation.id,
        metadata: {
          email: invitation.email,
          userId: user.id,
          platformRole: invitation.platformRole,
          roleGroupId: invitation.roleGroupId,
        },
      },
    );

    return {
      accountExists: false,
      email: invitation.email,
      spaceName: "服务支持协作团队",
      platformRole: invitation.platformRole,
      roleGroupName: invitation.roleGroup?.name ?? null,
    };
  });
}
