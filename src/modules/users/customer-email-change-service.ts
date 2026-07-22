import "server-only";

import { z } from "zod";
import type { Actor } from "@/lib/actor";
import { withActorDb } from "@/lib/actor";
import { withSystemDb } from "@/lib/system-db";
import {
  assertMailDeliveryReady,
  createMailMessageInTx,
  dispatchQueuedMailMessage,
} from "@/lib/jobs";
import { env } from "@/lib/runtime-env";
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
import { resolveLockedMailDeliveryMode } from "@/modules/platform-settings/mail-provider-lifecycle";
import { mailboxFromSender } from "@/modules/platform-settings/smtp-sender";

const emailSchema = z.string().trim().email().max(160);

export async function requestCustomerEmailChange(
  actor: Actor,
  userId: string,
  rawEmail: string,
) {
  assertAllowed(actor.isPlatformAdmin);
  await assertMailDeliveryReady();
  const newEmail = emailSchema.parse(rawEmail).toLowerCase();
  const token = createInvitationToken();
  const now = new Date();
  const appUrl = await getPublicAppUrl();
  const actionUrl = `${appUrl}/confirm-email-change?token=${encodeURIComponent(token.token)}`;

  const result = await withActorDb(actor, async (tx) => {
    const deliveryMode = await resolveLockedMailDeliveryMode(tx);
    await tx.userEmailChange.updateMany({
      where: {
        status: "PENDING",
        expiresAt: { lte: now },
      },
      data: { status: "EXPIRED" },
    });

    const user = await tx.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        platformRole: true,
      },
    });
    assertFound(user, "客户账号不存在");
    if (user.platformRole !== "CUSTOMER") {
      throw new DomainError(
        "EMAIL_CHANGE_CUSTOMER_ONLY",
        "该入口只用于修改客户账号邮箱",
        409,
      );
    }
    if (user.email.toLowerCase() === newEmail) {
      throw new DomainError(
        "EMAIL_UNCHANGED",
        "新邮箱与当前登录邮箱相同",
        409,
      );
    }

    await assertEmailAvailable(tx, newEmail, user.id);

    const completing = await tx.userEmailChange.findFirst({
      where: { userId, status: "COMPLETING" },
      select: { id: true },
    });
    if (completing) {
      throw new DomainError(
        "EMAIL_CHANGE_IN_PROGRESS",
        "该账号的邮箱变更正在完成，请稍后刷新",
        409,
      );
    }

    const replacedChanges = await tx.userEmailChange.findMany({
      where: { userId, status: "PENDING" },
      select: { id: true },
    });
    await tx.userEmailChange.updateMany({
      where: { userId, status: "PENDING" },
      data: {
        status: "CANCELLED",
        cancelledAt: now,
      },
    });
    if (replacedChanges.length > 0) {
      await tx.mailMessage.updateMany({
        where: {
          sourceType: "CUSTOMER_EMAIL_CHANGE_VERIFY",
          sourceId: { in: replacedChanges.map((item) => item.id) },
          status: "QUEUED",
        },
        data: {
          status: "CANCELLED",
          errorMessage: "邮箱变更已被新的申请替换",
        },
      });
    }
    const change = await tx.userEmailChange.create({
      data: {
        userId,
        oldEmail: user.email.toLowerCase(),
        newEmail,
        tokenHash: token.tokenHash,
        expiresAt: token.expiresAt,
        lastSentAt: now,
        requestedById: actor.id,
      },
    });
    await writeAuditLog(tx, actor, {
      action: "CUSTOMER_EMAIL_CHANGE_REQUESTED",
      resourceType: "UserEmailChange",
      resourceId: change.id,
      metadata: {
        userId,
        oldEmail: change.oldEmail,
        newEmail: change.newEmail,
      },
    });
    const mailMessage = await createMailMessageInTx(tx, {
      to: change.newEmail,
      templateKey: "CUSTOMER_EMAIL_CHANGE_VERIFY",
      variables: {
        recipientName: user.name,
        oldEmail: change.oldEmail,
        newEmail: change.newEmail,
        operatorName: actor.name,
        expiresIn: "24 小时",
      },
      actionUrl,
      deliveryMode,
      idempotencyKey: `customer-email-change:${change.id}:verify:${token.tokenHash}`,
      sourceType: "CUSTOMER_EMAIL_CHANGE_VERIFY",
      sourceId: change.id,
    });
    return { change, mailMessage };
  });

  await dispatchQueuedMailMessage(
    result.mailMessage.id,
    result.mailMessage.deliveryMode,
    result.mailMessage.sendAfter,
  );

  return publicChange(result.change, result.mailMessage.status);
}

export async function resendCustomerEmailChange(
  actor: Actor,
  userId: string,
) {
  assertAllowed(actor.isPlatformAdmin);
  await assertMailDeliveryReady();
  const token = createInvitationToken();
  const now = new Date();
  const appUrl = await getPublicAppUrl();
  const actionUrl = `${appUrl}/confirm-email-change?token=${encodeURIComponent(token.token)}`;
  const result = await withActorDb(actor, async (tx) => {
    const deliveryMode = await resolveLockedMailDeliveryMode(tx);
    const change = await tx.userEmailChange.findFirst({
      where: { userId, status: "PENDING" },
      include: { user: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
    });
    assertFound(change, "没有待验证的邮箱变更");
    if (change.expiresAt <= now) {
      await tx.userEmailChange.update({
        where: { id: change.id },
        data: { status: "EXPIRED" },
      });
      throw new DomainError(
        "EMAIL_CHANGE_EXPIRED",
        "邮箱变更已过期，请重新发起",
        410,
      );
    }
    await assertEmailAvailable(tx, change.newEmail, userId, change.id);
    const updated = await tx.userEmailChange.update({
      where: { id: change.id },
      data: {
        tokenHash: token.tokenHash,
        expiresAt: token.expiresAt,
        lastSentAt: now,
      },
    });
    await tx.mailMessage.updateMany({
      where: {
        sourceType: "CUSTOMER_EMAIL_CHANGE_VERIFY",
        sourceId: change.id,
        status: "QUEUED",
      },
      data: {
        status: "CANCELLED",
        errorMessage: "已生成新的邮箱验证链接",
      },
    });
    await writeAuditLog(tx, actor, {
      action: "CUSTOMER_EMAIL_CHANGE_RESENT",
      resourceType: "UserEmailChange",
      resourceId: change.id,
      metadata: { userId, newEmail: change.newEmail },
    });
    const mailMessage = await createMailMessageInTx(tx, {
      to: updated.newEmail,
      templateKey: "CUSTOMER_EMAIL_CHANGE_VERIFY",
      variables: {
        recipientName: change.user.name,
        oldEmail: updated.oldEmail,
        newEmail: updated.newEmail,
        operatorName: actor.name,
        expiresIn: "24 小时",
      },
      actionUrl,
      deliveryMode,
      idempotencyKey: `customer-email-change:${updated.id}:verify:${token.tokenHash}`,
      sourceType: "CUSTOMER_EMAIL_CHANGE_VERIFY",
      sourceId: updated.id,
    });
    return {
      change: updated,
      mailMessage,
    };
  });

  await dispatchQueuedMailMessage(
    result.mailMessage.id,
    result.mailMessage.deliveryMode,
    result.mailMessage.sendAfter,
  );
  return publicChange(result.change, result.mailMessage.status);
}

export function cancelCustomerEmailChange(actor: Actor, userId: string) {
  assertAllowed(actor.isPlatformAdmin);
  return withActorDb(actor, async (tx) => {
    const change = await tx.userEmailChange.findFirst({
      where: { userId, status: "PENDING" },
      orderBy: { createdAt: "desc" },
    });
    assertFound(change, "没有待验证的邮箱变更");
    const updated = await tx.userEmailChange.update({
      where: { id: change.id },
      data: {
        status: "CANCELLED",
        cancelledAt: new Date(),
      },
    });
    await tx.mailMessage.updateMany({
      where: {
        sourceType: "CUSTOMER_EMAIL_CHANGE_VERIFY",
        sourceId: change.id,
        status: "QUEUED",
      },
      data: {
        status: "CANCELLED",
        errorMessage: "邮箱变更已取消",
      },
    });
    await writeAuditLog(tx, actor, {
      action: "CUSTOMER_EMAIL_CHANGE_CANCELLED",
      resourceType: "UserEmailChange",
      resourceId: change.id,
      metadata: { userId, newEmail: change.newEmail },
    });
    return publicChange(updated);
  });
}

export function getEmailChangePreview(token: string) {
  if (!token || token.length < 32) return null;
  return withSystemDb(async (tx) => {
    const change = await tx.userEmailChange.findUnique({
      where: { tokenHash: hashInvitationToken(token) },
      include: { user: { select: { name: true } } },
    });
    if (
      !change ||
      change.status !== "PENDING" ||
      change.expiresAt <= new Date()
    ) {
      return null;
    }
    return {
      recipientName: change.user.name,
      oldEmail: change.oldEmail,
      newEmail: change.newEmail,
      expiresAt: change.expiresAt.toISOString(),
    };
  });
}

export async function confirmCustomerEmailChange(rawToken: string) {
  const token = z.string().min(32).max(512).parse(rawToken);
  const now = new Date();
  const result = await withSystemDb(async (tx) => {
    let deliveryMode: Awaited<
      ReturnType<typeof resolveLockedMailDeliveryMode>
    > | null = null;
    try {
      deliveryMode = await resolveLockedMailDeliveryMode(tx);
    } catch (error) {
      if (
        !(error instanceof DomainError) ||
        ![
          "MAIL_DELIVERY_NOT_CONFIGURED",
          "RESEND_NOT_READY",
          "SMTP_NOT_READY",
        ].includes(error.code)
      ) {
        throw error;
      }
    }
    const settings = await tx.platformSetting.findUnique({
      where: { id: 1 },
      select: {
        appUrl: true,
        mailMode: true,
        mailFrom: true,
        smtpFrom: true,
        smtpUser: true,
      },
    });
    const change = await tx.userEmailChange.findUnique({
      where: { tokenHash: hashInvitationToken(token) },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            platformRole: true,
          },
        },
      },
    });
    if (!change || change.status !== "PENDING") {
      throw new DomainError(
        "EMAIL_CHANGE_INVALID",
        "确认链接无效或已使用",
        410,
      );
    }
    if (change.expiresAt <= now) {
      await tx.userEmailChange.update({
        where: { id: change.id },
        data: { status: "EXPIRED" },
      });
      throw new DomainError(
        "EMAIL_CHANGE_EXPIRED",
        "确认链接已过期，请联系管理员重新发起",
        410,
      );
    }
    if (
      change.user.platformRole !== "CUSTOMER" ||
      change.user.email.toLowerCase() !== change.oldEmail
    ) {
      throw new DomainError(
        "EMAIL_CHANGE_STALE",
        "账号信息已经变化，请联系管理员重新发起",
        409,
      );
    }
    await assertEmailAvailable(tx, change.newEmail, change.userId, change.id);

    const claimed = await tx.userEmailChange.updateMany({
      where: {
        id: change.id,
        status: "PENDING",
        expiresAt: { gt: now },
      },
      data: { status: "COMPLETING" },
    });
    if (claimed.count !== 1) {
      throw new DomainError(
        "EMAIL_CHANGE_INVALID",
        "确认链接无效或已使用",
        410,
      );
    }

    await tx.invitation.updateMany({
      where: {
        email: {
          equals: change.oldEmail,
          mode: "insensitive",
        },
        acceptedAt: null,
        revokedAt: null,
        expiresAt: { gt: now },
      },
      data: { email: change.newEmail },
    });
    await tx.user.update({
      where: { id: change.userId },
      data: {
        email: change.newEmail,
        emailVerified: true,
      },
    });
    await tx.session.deleteMany({ where: { userId: change.userId } });
    const completed = await tx.userEmailChange.update({
      where: { id: change.id },
      data: {
        status: "COMPLETED",
        completedAt: now,
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
        action: "CUSTOMER_EMAIL_CHANGE_COMPLETED",
        resourceType: "UserEmailChange",
        resourceId: change.id,
        metadata: {
          userId: change.userId,
          oldEmail: change.oldEmail,
          newEmail: change.newEmail,
          requestedById: change.requestedById,
        },
      },
    );
    const variables = {
      recipientName: change.user.name,
      oldEmail: completed.oldEmail,
      newEmail: completed.newEmail,
    };
    const appUrl = (settings?.appUrl?.trim() || env.APP_URL).replace(/\/$/, "");
    const senderEmail =
      settings?.mailMode === "SMTP"
        ? mailboxFromSender(settings.smtpFrom) ?? settings.smtpUser
        : mailboxFromSender(settings?.mailFrom);
    const mailMessages = [];
    if (deliveryMode) {
      const completedMail = await createMailMessageInTx(tx, {
        to: completed.newEmail,
        templateKey: "CUSTOMER_EMAIL_CHANGE_COMPLETED",
        variables,
        actionUrl: `${appUrl}/login`,
        deliveryMode,
        idempotencyKey: `customer-email-change:${completed.id}:completed`,
        sourceType: "CUSTOMER_EMAIL_CHANGE_COMPLETED",
        sourceId: completed.id,
      });
      const securityMail = await createMailMessageInTx(tx, {
        to: completed.oldEmail,
        templateKey: "CUSTOMER_EMAIL_CHANGE_SECURITY_NOTICE",
        variables: {
          ...variables,
          supportEmail: senderEmail ?? "此邮件的发件人",
        },
        deliveryMode,
        idempotencyKey: `customer-email-change:${completed.id}:security-notice`,
        sourceType: "CUSTOMER_EMAIL_CHANGE_SECURITY_NOTICE",
        sourceId: completed.id,
      });
      mailMessages.push(completedMail, securityMail);
    }
    return {
      change: completed,
      recipientName: change.user.name,
      mailMessages,
    };
  });

  const notifications = await Promise.allSettled(
    result.mailMessages.map((message) =>
      dispatchQueuedMailMessage(
        message.id,
        message.deliveryMode,
        message.sendAfter,
      ),
    ),
  );
  if (notifications.some((item) => item.status === "rejected")) {
    console.error("CUSTOMER_EMAIL_CHANGE_NOTICE_FAILED", {
      emailChangeId: result.change.id,
    });
  }

  return {
    recipientName: result.recipientName,
    newEmail: result.change.newEmail,
  };
}

async function assertEmailAvailable(
  tx: Parameters<Parameters<typeof withSystemDb>[0]>[0],
  newEmail: string,
  userId: string,
  currentChangeId?: string,
) {
  const user = await tx.user.findFirst({
      where: {
        email: {
          equals: newEmail,
          mode: "insensitive",
        },
      },
      select: { id: true },
    });
  const invitation = await tx.invitation.findFirst({
      where: {
        email: {
          equals: newEmail,
          mode: "insensitive",
        },
        acceptedAt: null,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      select: { id: true },
    });
  const staffInvitation = await tx.staffInvitation.findFirst({
      where: {
        email: {
          equals: newEmail,
          mode: "insensitive",
        },
        acceptedAt: null,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      select: { id: true },
    });
  const pendingChange = await tx.userEmailChange.findFirst({
      where: {
        newEmail,
        status: { in: ["PENDING", "COMPLETING"] },
        ...(currentChangeId ? { id: { not: currentChangeId } } : {}),
      },
      select: { id: true, userId: true },
    });
  if (user && user.id !== userId) {
    throw new DomainError(
      "EMAIL_ALREADY_IN_USE",
      "该邮箱已被其他账号使用",
      409,
    );
  }
  if (invitation || staffInvitation) {
    throw new DomainError(
      "EMAIL_HAS_ACTIVE_INVITATION",
      "该邮箱存在待处理邀请，请先撤销或完成邀请",
      409,
    );
  }
  if (pendingChange && pendingChange.userId !== userId) {
    throw new DomainError(
      "EMAIL_CHANGE_CONFLICT",
      "该邮箱正在用于其他账号的邮箱变更",
      409,
    );
  }
}

function publicChange(change: {
  id: string;
  oldEmail: string;
  newEmail: string;
  status: string;
  expiresAt: Date;
  lastSentAt: Date;
}, mailStatus?: string) {
  return {
    id: change.id,
    oldEmail: change.oldEmail,
    newEmail: change.newEmail,
    status: change.status,
    expiresAt: change.expiresAt.toISOString(),
    lastSentAt: change.lastSentAt.toISOString(),
    mailStatus: mailStatus ?? null,
  };
}
