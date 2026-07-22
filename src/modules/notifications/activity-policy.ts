import type {
  EventType,
  NotificationType,
  RequestStatus,
} from "@/generated/prisma/client";

export const PROJECT_UPDATE_NOTIFICATION_TYPES: NotificationType[] = [
  "PROJECT_UPDATE",
  "UPDATE_COMMENT",
];

export const PROJECT_DELIVERY_NOTIFICATION_TYPES: NotificationType[] = [
  ...PROJECT_UPDATE_NOTIFICATION_TYPES,
  "PROJECT_STAGE",
  "PROJECT_MILESTONE",
  "PROJECT_FILE",
];

export const REQUEST_NOTIFICATION_TYPES: NotificationType[] = [
  "REQUEST_CREATED",
  "REQUEST_ASSIGNED",
  "REQUEST_MESSAGE",
  "REQUEST_STATUS",
  "REQUEST_ATTACHMENT",
  "REQUEST_ARCHIVE",
];

const silentProjectChanges = new Set([
  "PROJECT_UPDATED",
  "PROJECT_STAFF_ADDED",
  "PROJECT_STAFF_UPDATED",
  "PROJECT_STAFF_REMOVED",
  "PROJECT_ACCESS_REVOKED",
  "ATTACHMENT_OPTIMIZED",
]);

const silentRequestChanges = new Set(["ATTACHMENT_OPTIMIZED"]);

export function isProjectChangeAudible(change: string) {
  return !silentProjectChanges.has(change);
}

export function isRequestChangeAudible(change: string) {
  return !silentRequestChanges.has(change);
}

export function isCustomerStatusEmailEligible(status: RequestStatus) {
  return (
    status === "WAITING_CUSTOMER" ||
    status === "RESOLVED" ||
    status === "CLOSED"
  );
}

export function isProjectDeliveryNotification(type: string) {
  return PROJECT_DELIVERY_NOTIFICATION_TYPES.includes(type as NotificationType);
}

export function isProjectUpdateNotification(type: string) {
  return PROJECT_UPDATE_NOTIFICATION_TYPES.includes(type as NotificationType);
}

export function isRequestNotification(type: string) {
  return REQUEST_NOTIFICATION_TYPES.includes(type as NotificationType);
}

export function planStandardRequestEmailRecipientIds(input: {
  actorId: string;
  actorPlatformRole: string;
  eventType: EventType;
  visibility?: string;
  status?: string;
  includeCustomers: boolean;
  customerUserIds: string[];
  projectManagerUserIds: string[];
  platformAdminUserIds: string[];
  relevantWorkerUserIds?: Array<string | null | undefined>;
  emailWorkerUserIds?: Array<string | null | undefined>;
}) {
  let recipients: Array<string | null | undefined> = [];
  if (input.eventType === "REQUEST_CREATED") {
    recipients = [
      ...input.projectManagerUserIds,
      ...input.platformAdminUserIds,
    ];
  } else if (input.eventType === "REQUEST_ASSIGNED") {
    recipients = input.emailWorkerUserIds ?? [];
  } else if (
    input.eventType === "REQUEST_MESSAGE_CREATED" &&
    input.visibility === "CUSTOMER_VISIBLE"
  ) {
    recipients =
      input.actorPlatformRole === "CUSTOMER"
        ? input.relevantWorkerUserIds ?? []
        : input.includeCustomers
          ? input.customerUserIds
          : [];
  } else if (
    input.eventType === "REQUEST_STATUS_CHANGED" &&
    input.actorPlatformRole !== "CUSTOMER" &&
    isRequestStatus(input.status) &&
    isCustomerStatusEmailEligible(input.status)
  ) {
    recipients = input.includeCustomers ? input.customerUserIds : [];
  }

  return uniqueStrings(recipients).filter(
    (userId) => userId !== input.actorId,
  );
}

function isRequestStatus(value?: string): value is RequestStatus {
  return (
    value === "PENDING" ||
    value === "IN_PROGRESS" ||
    value === "WAITING_CUSTOMER" ||
    value === "RESOLVED" ||
    value === "CLOSED"
  );
}

function uniqueStrings(values: Array<string | null | undefined>) {
  return [
    ...new Set(
      values.filter(
        (value): value is string =>
          typeof value === "string" && value.length > 0,
      ),
    ),
  ];
}
