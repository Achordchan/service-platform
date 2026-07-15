import type {
  ContentVisibility,
  EventType,
  NotificationType,
  Prisma,
} from "@/generated/prisma/client";

export type ActivityAudience = {
  customerUserIds: string[];
  projectStaffUserIds: string[];
  projectManagerUserIds: string[];
  platformAdminUserIds: string[];
};

export type ActivityEvent = {
  type: EventType;
  payload: Prisma.InputJsonValue;
  userId?: string;
  customerSpaceId?: string;
  projectId?: string;
  serviceRequestId?: string;
};

export type ActivityNotification = {
  type: NotificationType;
  title: string;
  body: string;
  userId: string;
  customerSpaceId?: string;
  projectId?: string;
  serviceRequestId?: string;
  aggregationKey?: string;
};

export type ActivityDelivery = {
  events: ActivityEvent[];
  notifications: ActivityNotification[];
};

type ProjectActivityInput = {
  actorId: string;
  audience: ActivityAudience;
  visibility: ContentVisibility;
  eventType: Extract<
    EventType,
    "PROJECT_UPDATE_CREATED" | "UPDATE_COMMENT_CREATED"
  >;
  eventPayload: Prisma.InputJsonValue;
  notificationType: Extract<
    NotificationType,
    "PROJECT_UPDATE" | "UPDATE_COMMENT"
  >;
  notificationTitle: string;
  notificationBody: string;
  customerSpaceId: string;
  projectId: string;
};

type RequestActivityInput = {
  actorId: string;
  audience: ActivityAudience;
  relevantWorkerUserIds?: Array<string | null | undefined>;
  includeCustomers: boolean;
  notifyProjectManagers: boolean;
  notifyPlatformAdmins: boolean;
  createNotifications?: boolean;
  eventType: Extract<
    EventType,
    | "REQUEST_CREATED"
    | "REQUEST_ASSIGNED"
    | "REQUEST_MESSAGE_CREATED"
    | "REQUEST_STATUS_CHANGED"
  >;
  eventPayload: Prisma.InputJsonValue;
  notificationType: Extract<
    NotificationType,
    | "REQUEST_CREATED"
    | "REQUEST_ASSIGNED"
    | "REQUEST_MESSAGE"
    | "REQUEST_STATUS"
  >;
  notificationTitle: string;
  notificationBody: string;
  customerSpaceId: string;
  projectId: string;
  serviceRequestId: string;
};

export function planProjectActivity(
  input: ProjectActivityInput,
): ActivityDelivery {
  const staffUserIds = unique([
    ...input.audience.projectStaffUserIds,
    ...input.audience.platformAdminUserIds,
  ]);
  const recipientUserIds = unique([
    ...(input.visibility === "CUSTOMER_VISIBLE"
      ? input.audience.customerUserIds
      : []),
    ...staffUserIds,
  ]);

  const events =
    input.visibility === "CUSTOMER_VISIBLE"
      ? [
          {
            type: input.eventType,
            payload: input.eventPayload,
            customerSpaceId: input.customerSpaceId,
            projectId: input.projectId,
          },
        ]
      : unique([...staffUserIds, input.actorId]).map((userId) => ({
          type: input.eventType,
          payload: input.eventPayload,
          userId,
          customerSpaceId: input.customerSpaceId,
          projectId: input.projectId,
        }));

  return {
    events,
    notifications: withoutActor(recipientUserIds, input.actorId).map(
      (userId) => ({
        type: input.notificationType,
        title: input.notificationTitle,
        body: input.notificationBody,
        userId,
        customerSpaceId: input.customerSpaceId,
        projectId: input.projectId,
      }),
    ),
  };
}

export function planRequestActivity(
  input: RequestActivityInput,
): ActivityDelivery {
  const notificationUserIds = unique([
    ...(input.includeCustomers ? input.audience.customerUserIds : []),
    ...(input.notifyProjectManagers
      ? input.audience.projectManagerUserIds
      : []),
    ...(input.notifyPlatformAdmins
      ? input.audience.platformAdminUserIds
      : []),
    ...(input.relevantWorkerUserIds ?? []),
  ]);

  const eventUserIds = unique([
    ...(input.includeCustomers ? input.audience.customerUserIds : []),
    ...input.audience.projectManagerUserIds,
    ...input.audience.platformAdminUserIds,
    ...(input.relevantWorkerUserIds ?? []),
    input.actorId,
  ]);

  return {
    events: eventUserIds.map((userId) => ({
      type: input.eventType,
      payload: input.eventPayload,
      userId,
      customerSpaceId: input.customerSpaceId,
      projectId: input.projectId,
      serviceRequestId: input.serviceRequestId,
    })),
    notifications:
      input.createNotifications === false
        ? []
        : withoutActor(notificationUserIds, input.actorId).map((userId) => ({
            type: input.notificationType,
            title: input.notificationTitle,
            body: input.notificationBody,
            userId,
            customerSpaceId: input.customerSpaceId,
            projectId: input.projectId,
            serviceRequestId: input.serviceRequestId,
            aggregationKey: `request:${input.serviceRequestId}`,
          })),
  };
}

function withoutActor(userIds: string[], actorId: string) {
  return userIds.filter((userId) => userId !== actorId);
}

function unique(userIds: Array<string | null | undefined>) {
  return [
    ...new Set(
      userIds.filter(
        (userId): userId is string =>
          typeof userId === "string" && userId.length > 0,
      ),
    ),
  ];
}
