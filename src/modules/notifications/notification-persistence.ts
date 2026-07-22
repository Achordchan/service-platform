import type { NotificationType } from "@/generated/prisma/client";
import type { ActivityNotification } from "@/modules/notifications/activity-delivery";

export type NotificationPersistenceInput = {
  type: NotificationType;
  title: string;
  body: string;
  userId: string;
  customerSpaceId?: string;
  projectId?: string;
  serviceRequestId?: string;
  aggregationKey?: string;
  emailDueAt?: Date;
};

export function toNotificationPersistenceInput(
  notification: ActivityNotification,
  emailDueAt?: Date,
): NotificationPersistenceInput {
  return {
    type: notification.type,
    title: notification.title,
    body: notification.body,
    userId: notification.userId,
    customerSpaceId: notification.customerSpaceId,
    projectId: notification.projectId,
    serviceRequestId: notification.serviceRequestId,
    aggregationKey: notification.aggregationKey,
    emailDueAt,
  };
}
