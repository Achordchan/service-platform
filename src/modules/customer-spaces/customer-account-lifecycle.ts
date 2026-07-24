import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import type { Actor } from "@/lib/actor";
import { writeAuditLog } from "@/modules/audit/audit-service";

export async function deactivateCustomerAccountIfOrphaned(
  tx: Prisma.TransactionClient,
  actor: Actor,
  userId: string,
  options: {
    excludingCustomerSpaceId?: string;
    sourceCustomerSpaceId?: string;
  } = {},
) {
  const user = await tx.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      email: true,
      platformRole: true,
      deletedAt: true,
      memberships: {
        where: options.excludingCustomerSpaceId
          ? { customerSpaceId: { not: options.excludingCustomerSpaceId } }
          : undefined,
        select: { id: true },
        take: 1,
      },
      ownedSpaces: {
        where: options.excludingCustomerSpaceId
          ? { id: { not: options.excludingCustomerSpaceId } }
          : undefined,
        select: { id: true },
        take: 1,
      },
    },
  });
  if (
    !user ||
    user.deletedAt ||
    user.platformRole !== "CUSTOMER" ||
    user.memberships.length > 0 ||
    user.ownedSpaces.length > 0
  ) {
    return false;
  }

  const now = new Date();
  await tx.session.deleteMany({ where: { userId } });
  await tx.account.deleteMany({ where: { userId } });
  await tx.notification.deleteMany({ where: { userId } });
  await tx.requestPresence.deleteMany({ where: { userId } });
  await tx.invitation.updateMany({
    where: {
      email: user.email,
      acceptedAt: null,
      revokedAt: null,
    },
    data: { revokedAt: now },
  });
  const pendingChanges = await tx.userEmailChange.findMany({
    where: { userId, status: { in: ["PENDING", "COMPLETING"] } },
    select: { id: true },
  });
  if (pendingChanges.length > 0) {
    await tx.userEmailChange.updateMany({
      where: { id: { in: pendingChanges.map((change) => change.id) } },
      data: { status: "CANCELLED" },
    });
    await tx.mailMessage.updateMany({
      where: {
        sourceType: "CUSTOMER_EMAIL_CHANGE_VERIFY",
        sourceId: { in: pendingChanges.map((change) => change.id) },
        status: { in: ["QUEUED", "PROCESSING"] },
      },
      data: {
        status: "CANCELLED",
        errorMessage: "客户账号已删除",
      },
    });
  }
  await tx.user.update({
    where: { id: userId },
    data: {
      name: "已删除客户",
      email: `deleted-customer-${userId}@deleted.invalid`,
      emailVerified: false,
      image: null,
      phone: null,
      company: null,
      jobTitle: null,
      wechat: null,
      website: null,
      location: null,
      contactNotes: null,
      soundNotificationsEnabled: false,
      requestEmailNotificationsEnabled: false,
      deletedAt: now,
    },
  });
  await writeAuditLog(tx, actor, {
    action: "CUSTOMER_ACCOUNT_DELETED",
    resourceType: "User",
    resourceId: user.id,
    customerSpaceId: options.sourceCustomerSpaceId,
    metadata: {
      name: user.name,
      email: user.email,
      sourceCustomerSpaceId: options.sourceCustomerSpaceId,
      historyPreserved: true,
    },
  });
  return true;
}
