import "server-only";

import type { NotificationType, Prisma } from "@/generated/prisma/client";
import { env } from "@/lib/runtime-env";
import { withSystemDb } from "@/lib/system-db";
import { buildTemplateMailInTx } from "@/modules/platform-settings/mail-template-service";
import { lockPlatformMailSettings } from "@/modules/platform-settings/mail-provider-lifecycle";
import type { MailTemplateKey } from "@/modules/platform-settings/mail-template-catalog";
import {
  canSendStandardRequestEmailForModule,
  isStandardRequestRecipientRelevant,
} from "@/modules/notifications/standard-request-mail-policy";
import {
  isNotificationEmailRuleEnabled,
  STANDARD_NOTIFICATION_EMAIL_RULE_KEYS,
  type NotificationDeliveryRuleState,
} from "@/modules/notifications/notification-delivery-rules";
import {
  canSendStandardProjectEmailForModule,
  isStandardProjectRecipientRelevant,
} from "@/modules/notifications/standard-project-mail-policy";

const CLAIM_STALE_MS = 15 * 60 * 1000;
const BATCH_SIZE = 50;

function requestTemplateFor(
  type: NotificationType,
  customer: boolean,
): MailTemplateKey {
  if (!customer && type === "REQUEST_ASSIGNED") {
    return "STANDARD_REQUEST_ASSIGNMENT";
  }
  return customer
    ? "STANDARD_REQUEST_CUSTOMER_UPDATE"
    : "STANDARD_REQUEST_STAFF_UPDATE";
}

export async function createDueNotificationMailMessages() {
  return withSystemDb(async (tx) => {
    const now = new Date();
    const staleBefore = new Date(now.getTime() - CLAIM_STALE_MS);
    const settings = await lockPlatformMailSettings(tx);
    const claimedRows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id
      FROM "Notification"
      WHERE "readAt" IS NULL
        AND "emailDueAt" <= ${now}
        AND (
          "emailClaimedAt" IS NULL
          OR "emailClaimedAt" < ${staleBefore}
        )
      ORDER BY "emailDueAt" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT ${BATCH_SIZE}
    `;
    const ids = claimedRows.map((row) => row.id);
    if (ids.length === 0) return [];
    await tx.notification.updateMany({
      where: { id: { in: ids }, readAt: null },
      data: { emailClaimedAt: now },
    });

    const notifications = await tx.notification.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        type: true,
        title: true,
        body: true,
        readAt: true,
        emailDueAt: true,
        occurrenceCount: true,
        emailLastSentOccurrenceCount: true,
        userId: true,
        serviceRequestId: true,
        projectId: true,
      },
    });
    const users = await tx.user.findMany({
      where: { id: { in: [...new Set(notifications.map((item) => item.userId))] } },
      select: {
        id: true,
        name: true,
        email: true,
        platformRole: true,
        requestEmailNotificationsEnabled: true,
      },
    });
    const requests = await tx.serviceRequest.findMany({
      where: {
        id: {
          in: notifications.flatMap((item) =>
            item.serviceRequestId ? [item.serviceRequestId] : [],
          ),
        },
      },
      select: {
        id: true,
        number: true,
        title: true,
        archivedAt: true,
        projectId: true,
      },
    });
    const projectIds = [
      ...new Set([
        ...notifications.flatMap((item) =>
          item.projectId ? [item.projectId] : [],
        ),
        ...requests.map((request) => request.projectId),
      ]),
    ];
    const projects = await tx.project.findMany({
      where: { id: { in: projectIds } },
      select: {
        id: true,
        title: true,
        kind: true,
        customerSpaceId: true,
        customerUpdatesEnabled: true,
        customerRequestsEnabled: true,
        customerFilesEnabled: true,
        showMilestones: true,
        showProgress: true,
      },
    });
    const memberships = await tx.membership.findMany({
      where: {
        customerSpaceId: {
          in: [...new Set(projects.map((project) => project.customerSpaceId))],
        },
      },
      select: { customerSpaceId: true, userId: true },
    });
    const projectStaff = await tx.projectStaff.findMany({
      where: { projectId: { in: projectIds } },
      select: { projectId: true, userId: true },
    });
    const requestAssignees = await tx.requestAssignee.findMany({
      where: { serviceRequestId: { in: requests.map((request) => request.id) } },
      select: { serviceRequestId: true, userId: true },
    });
    const deliveryRules = await tx.notificationDeliveryRule.findMany({
      where: { key: { in: [...STANDARD_NOTIFICATION_EMAIL_RULE_KEYS] } },
      select: {
        key: true,
        notificationEnabled: true,
        soundEnabled: true,
        emailEnabled: true,
      },
    });
    const deliveryRuleByKey = new Map<string, NotificationDeliveryRuleState>(
      deliveryRules.map((rule) => [rule.key, rule]),
    );
    const userById = new Map(users.map((user) => [user.id, user]));
    const requestById = new Map(requests.map((request) => [request.id, request]));
    const projectById = new Map(projects.map((project) => [project.id, project]));
    const membershipUserIdsBySpaceId = groupUserIds(
      memberships,
      "customerSpaceId",
    );
    const staffUserIdsByProjectId = groupUserIds(projectStaff, "projectId");
    const assigneeUserIdsByRequestId = groupUserIds(
      requestAssignees,
      "serviceRequestId",
    );

    const createdIds: string[] = [];
    for (const notification of notifications) {
      const user = userById.get(notification.userId);
      if (!user) {
        await clearClaim(tx, notification.id);
        continue;
      }
      const requestRow = notification.serviceRequestId
        ? requestById.get(notification.serviceRequestId)
        : null;
      const requestProject = requestRow
        ? projectById.get(requestRow.projectId)
        : null;
      const request =
        requestRow && requestProject
          ? {
              ...requestRow,
              assignees: (
                assigneeUserIdsByRequestId.get(requestRow.id) ?? []
              ).map((userId) => ({ userId })),
              project: {
                ...requestProject,
                customerSpace: {
                  memberships: (
                    membershipUserIdsBySpaceId.get(
                      requestProject.customerSpaceId,
                    ) ?? []
                  ).map((userId) => ({ userId })),
                },
                staff: (
                  staffUserIdsByProjectId.get(requestProject.id) ?? []
                ).map((userId) => ({ userId })),
              },
            }
          : null;
      const projectRow = notification.projectId
        ? projectById.get(notification.projectId)
        : null;
      const project = projectRow
        ? {
            ...projectRow,
            customerSpace: {
              memberships: (
                membershipUserIdsBySpaceId.get(projectRow.customerSpaceId) ?? []
              ).map((userId) => ({ userId })),
            },
          }
        : null;
      const customer = user.platformRole === "CUSTOMER";
      const commonValid = Boolean(
          settings?.standardRequestEmailEnabled &&
          settings.mailMode !== "LOCAL_OUTBOX" &&
          isNotificationEmailRuleEnabled(
            notification.type,
            deliveryRuleByKey,
          ) &&
          notification.readAt === null &&
          notification.emailDueAt &&
          notification.occurrenceCount >
            notification.emailLastSentOccurrenceCount &&
          user.requestEmailNotificationsEnabled,
      );
      const requestValid = Boolean(
          commonValid &&
          request &&
          !request.archivedAt &&
          request.project.kind === "STANDARD" &&
          canSendStandardRequestEmailForModule({
            platformRole: user.platformRole,
            customerRequestsEnabled: request.project.customerRequestsEnabled,
          }) &&
          isStandardRequestRecipientRelevant({
            userId: user.id,
            platformRole: user.platformRole,
            membershipUserIds: request?.project.customerSpace.memberships.map(
              (item) => item.userId,
            ) ?? [],
            projectStaffUserIds:
              request?.project.staff.map((item) => item.userId) ?? [],
            assigneeUserIds: request?.assignees.map((item) => item.userId) ?? [],
          }),
      );
      const projectValid = Boolean(
        commonValid &&
          project &&
          project.kind === "STANDARD" &&
          isStandardProjectRecipientRelevant({
            userId: user.id,
            platformRole: user.platformRole,
            membershipUserIds: project.customerSpace.memberships.map(
              (item) => item.userId,
            ),
          }) &&
          canSendStandardProjectEmailForModule({
            notificationType: notification.type,
            customerUpdatesEnabled: project.customerUpdatesEnabled,
            customerFilesEnabled: project.customerFilesEnabled,
            showMilestones: project.showMilestones,
            showProgress: project.showProgress,
          }),
      );
      if ((!requestValid && !projectValid) || !settings) {
        await clearClaim(tx, notification.id);
        continue;
      }

      const idempotencyKey = `notification:${notification.id}:${notification.occurrenceCount}`;
      const existing = await tx.mailMessage.findUnique({
        where: { idempotencyKey },
        select: { id: true },
      });
      if (existing) {
        await clearClaim(tx, notification.id);
        continue;
      }
      const appUrl = (settings.appUrl?.trim() || env.APP_URL).replace(/\/$/, "");
      const template = await buildTemplateMailInTx(tx, {
        key: requestValid
          ? requestTemplateFor(notification.type, customer)
          : "STANDARD_PROJECT_CUSTOMER_UPDATE",
        variables: requestValid
          ? {
              recipientName: user.name,
              requestNumber: request!.number,
              requestTitle: request!.title,
              projectName: request!.project.title,
              notificationTitle: notification.title,
              notificationBody: notification.body,
            }
          : {
              recipientName: user.name,
              projectName: project!.title,
              notificationTitle: notification.title,
              notificationBody: notification.body,
            },
        actionUrl: requestValid
          ? customer
            ? `${appUrl}/customer/requests/${request!.id}`
            : `${appUrl}/staff/requests/${request!.id}`
          : `${appUrl}/customer/projects/${project!.id}`,
      });
      const message = await tx.mailMessage.create({
        data: {
          toEmail: user.email,
          templateKey: template.templateKey,
          subject: template.subject,
          previewText: template.previewText,
          heading: template.heading,
          body: template.body,
          actionLabel: template.actionLabel,
          actionUrl: template.actionUrl,
          deliveryMode: settings.mailMode,
          sendAfter: now,
          idempotencyKey,
          notificationId: notification.id,
          notificationOccurrenceCount: notification.occurrenceCount,
          sourceType: requestValid
            ? "STANDARD_REQUEST_NOTIFICATION"
            : "STANDARD_PROJECT_NOTIFICATION",
          sourceId: notification.id,
        },
        select: { id: true },
      });
      createdIds.push(message.id);
      await clearClaim(tx, notification.id);
    }
    return createdIds;
  });
}

function groupUserIds<Key extends "customerSpaceId" | "projectId" | "serviceRequestId">(
  rows: Array<Record<Key, string> & { userId: string }>,
  key: Key,
) {
  const grouped = new Map<string, string[]>();
  for (const row of rows) {
    const values = grouped.get(row[key]) ?? [];
    values.push(row.userId);
    grouped.set(row[key], values);
  }
  return grouped;
}

function clearClaim(tx: Prisma.TransactionClient, notificationId: string) {
  return tx.notification.update({
    where: { id: notificationId },
    data: { emailDueAt: null, emailClaimedAt: null },
  });
}
