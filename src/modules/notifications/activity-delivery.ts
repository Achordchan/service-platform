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
  sourceType?: string;
  sourceId?: string;
  aggregationKey?: string;
  emailEligible?: boolean;
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
    "PROJECT_UPDATED" | "PROJECT_UPDATE_CREATED" | "UPDATE_COMMENT_CREATED"
  >;
  eventPayload: Prisma.InputJsonValue;
  notificationType: Extract<
    NotificationType,
    | "PROJECT_CREATED"
    | "PROJECT_UPDATE"
    | "UPDATE_COMMENT"
    | "PROJECT_STAGE"
    | "PROJECT_MILESTONE"
    | "PROJECT_FILE"
  >;
  notificationTitle: string;
  notificationBody: string;
  customerSpaceId: string;
  projectId: string;
  emailRecipientUserIds?: string[];
  staffAudience?: "ALL_PROJECT_STAFF" | "PROJECT_MANAGERS";
};

type RequestActivityInput = {
  actorId: string;
  audience: ActivityAudience;
  relevantWorkerUserIds?: Array<string | null | undefined>;
  includeCustomers: boolean;
  notifyProjectManagers: boolean;
  notifyPlatformAdmins: boolean;
  createNotifications?: boolean;
  eventAudience?: "DEFAULT" | "NOTIFICATION_RECIPIENTS";
  eventType: Extract<
    EventType,
    | "REQUEST_CREATED"
    | "REQUEST_ASSIGNED"
    | "REQUEST_MESSAGE_CREATED"
    | "REQUEST_STATUS_CHANGED"
    | "REQUEST_UPDATED"
  >;
  eventPayload: Prisma.InputJsonValue;
  notificationType: Extract<
    NotificationType,
    | "REQUEST_CREATED"
    | "REQUEST_ASSIGNED"
    | "REQUEST_CLAIMED"
    | "REQUEST_MESSAGE"
    | "REQUEST_STATUS"
    | "REQUEST_ATTACHMENT"
    | "REQUEST_ARCHIVE"
  >;
  notificationTitle: string;
  notificationBody: string;
  customerSpaceId: string;
  projectId: string;
  serviceRequestId: string;
  sourceType?: string;
  sourceId?: string;
  emailRecipientUserIds?: string[];
};

export function planProjectActivity(
  input: ProjectActivityInput,
): ActivityDelivery {
  const staffUserIds =
    input.staffAudience === "PROJECT_MANAGERS"
      ? unique(input.audience.projectManagerUserIds)
      : unique([
          ...input.audience.projectStaffUserIds,
          ...input.audience.platformAdminUserIds,
        ]);
  const recipientUserIds = unique([
    ...(input.visibility === "CUSTOMER_VISIBLE"
      ? input.audience.customerUserIds
      : []),
    ...staffUserIds,
  ]);
  const emailRecipientUserIds = new Set(
    unique(input.emailRecipientUserIds ?? []),
  );

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
        emailEligible: emailRecipientUserIds.has(userId),
      }),
    ),
  };
}

type ProjectStaffActivityInput = {
  actorId: string;
  recipientUserId: string;
  change: string;
  audible: boolean;
  notificationTitle: string;
  notificationBody: string;
  customerSpaceId: string;
  projectId: string;
  emailEligible: boolean;
  notificationEnabled: boolean;
};

/**
 * 项目人员变动只提醒当事人，不广播给项目其他人（项目列表刷新由调用方原有的
 * publishProjectChange 负责，那条是静音的）。这里额外发一条按 userId 定向的
 * 事件，好让当事人这一侧按「声音」开关决定是否响铃。
 */
export function planProjectStaffActivity(
  input: ProjectStaffActivityInput,
): ActivityDelivery {
  if (input.recipientUserId === input.actorId) {
    return { events: [], notifications: [] };
  }
  return {
    events: [
      {
        type: "PROJECT_UPDATED",
        payload: {
          change: input.change,
          actorId: input.actorId,
          audible: input.audible,
          projectId: input.projectId,
        },
        userId: input.recipientUserId,
      },
    ],
    notifications: input.notificationEnabled
      ? [
          {
            type: "PROJECT_STAFF",
            title: input.notificationTitle,
            body: input.notificationBody,
            userId: input.recipientUserId,
            customerSpaceId: input.customerSpaceId,
            projectId: input.projectId,
            emailEligible: input.emailEligible,
          },
        ]
      : [],
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
  const emailRecipientUserIds = new Set(
    unique(input.emailRecipientUserIds ?? []),
  );

  const eventUserIds =
    input.eventAudience === "NOTIFICATION_RECIPIENTS"
      ? unique([...notificationUserIds, input.actorId])
      : unique([
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
            sourceType: input.sourceType,
            sourceId: input.sourceId,
            emailEligible: emailRecipientUserIds.has(userId),
            aggregationKey: requestAggregationKey(
              input.serviceRequestId,
              input.notificationType,
              emailRecipientUserIds.has(userId),
            ),
          })),
  };
}

function requestAggregationKey(
  serviceRequestId: string,
  notificationType: NotificationType,
  emailEligible: boolean,
) {
  return `request:${serviceRequestId}:${notificationType}:${
    emailEligible ? "mail" : "ui"
  }`;
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
