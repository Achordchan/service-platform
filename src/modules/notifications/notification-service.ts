import "server-only";

import { randomUUID } from "node:crypto";
import type {
  ContentVisibility,
  EventType,
  NotificationType,
  Prisma,
  RequestStatus,
} from "@/generated/prisma/client";
import type { Actor } from "@/lib/actor";
import { withActorDb } from "@/lib/actor";
import {
  planProjectActivity,
  planRequestActivity,
  type ActivityAudience,
  type ActivityDelivery,
} from "@/modules/notifications/activity-delivery";

type EventInput = {
  type: EventType;
  payload: Prisma.InputJsonValue;
  userId?: string;
  customerSpaceId?: string;
  projectId?: string;
  serviceRequestId?: string;
};

type TransientEventInput = {
  type: "REQUEST_TYPING_CHANGED";
  userIds: string[];
  payload: Prisma.InputJsonObject;
};

export async function publishEvent(
  tx: Prisma.TransactionClient,
  input: EventInput,
) {
  const [sequence] = await tx.$queryRaw<Array<{ id: bigint }>>`
    SELECT nextval(pg_get_serial_sequence('"EventRecord"', 'id'))::bigint AS id
  `;
  const id = sequence.id;
  await tx.eventRecord.createMany({
    data: [{ ...input, id }],
  });
  await tx.$executeRaw`SELECT pg_notify('service_platform_events', ${id.toString()})`;
  return { ...input, id };
}

export async function publishTransientEvent(
  tx: Prisma.TransactionClient,
  input: TransientEventInput,
) {
  const userIds = uniqueStrings(input.userIds);
  if (userIds.length === 0) return null;

  for (let index = 0; index < userIds.length; index += 100) {
    const envelope = JSON.stringify({
      type: input.type,
      userIds: userIds.slice(index, index + 100),
      payload: input.payload,
    });
    if (Buffer.byteLength(envelope, "utf8") > 7_000) {
      throw new Error("实时临时事件内容过大");
    }
    await tx.$executeRaw`
      SELECT pg_notify('service_platform_transient_events', ${envelope})
    `;
  }
  return { ...input, userIds };
}

export function publishProjectChange(
  tx: Prisma.TransactionClient,
  actor: Actor,
  input: {
    change: string;
    customerSpaceId: string;
    projectId: string;
    visibility?: ContentVisibility;
    payload?: Prisma.InputJsonObject;
  },
) {
  return publishEvent(tx, {
    type: "PROJECT_UPDATED",
    customerSpaceId: input.customerSpaceId,
    projectId: input.projectId,
    payload: {
      change: input.change,
      actorId: actor.id,
      projectId: input.projectId,
      ...(input.visibility ? { visibility: input.visibility } : {}),
      ...(input.payload ?? {}),
    },
  });
}

export function publishRequestChange(
  tx: Prisma.TransactionClient,
  actor: Actor,
  input: {
    change: string;
    customerSpaceId: string;
    projectId: string;
    serviceRequestId: string;
    visibility?: ContentVisibility;
    payload?: Prisma.InputJsonObject;
  },
) {
  return publishEvent(tx, {
    type: "REQUEST_UPDATED",
    customerSpaceId: input.customerSpaceId,
    projectId: input.projectId,
    serviceRequestId: input.serviceRequestId,
    payload: {
      change: input.change,
      actorId: actor.id,
      projectId: input.projectId,
      requestId: input.serviceRequestId,
      ...(input.visibility ? { visibility: input.visibility } : {}),
      ...(input.payload ?? {}),
    },
  });
}

export async function publishDetachedProjectChange(
  tx: Prisma.TransactionClient,
  actor: Actor,
  input: {
    change: string;
    projectId: string;
    userIds: string[];
    payload?: Prisma.InputJsonObject;
  },
) {
  const events = [];
  for (const userId of uniqueStrings([...input.userIds, actor.id])) {
    events.push(
      await publishEvent(tx, {
        type: "PROJECT_UPDATED",
        userId,
        payload: {
          change: input.change,
          actorId: actor.id,
          projectId: input.projectId,
          ...(input.payload ?? {}),
        },
      }),
    );
  }
  return events;
}

export async function publishProjectDeleted(
  tx: Prisma.TransactionClient,
  actor: Actor,
  projectId: string,
) {
  const audience = await loadProjectAudience(tx, projectId);
  return publishDetachedProjectChange(tx, actor, {
    change: "PROJECT_DELETED",
    projectId,
    userIds: [
      ...audience.customerUserIds,
      ...audience.projectStaffUserIds,
      ...audience.platformAdminUserIds,
    ],
  });
}

export async function createNotification(
  tx: Prisma.TransactionClient,
  input: {
    type: NotificationType;
    title: string;
    body: string;
    userId: string;
    customerSpaceId?: string;
    projectId?: string;
    serviceRequestId?: string;
    aggregationKey?: string;
  },
) {
  const notificationId = randomUUID();
  let notification: {
    id: string;
    occurrenceCount: number;
  };
  if (
    input.aggregationKey &&
    input.customerSpaceId &&
    input.projectId &&
    input.serviceRequestId
  ) {
    const [aggregated] = await tx.$queryRaw<
      Array<{ id: string; occurrence_count: number }>
    >`
      SELECT *
      FROM app_upsert_request_notification(
        ${notificationId},
        ${input.type},
        ${input.title},
        ${input.body},
        ${input.userId},
        ${input.customerSpaceId},
        ${input.projectId},
        ${input.serviceRequestId},
        ${input.aggregationKey}
      )
    `;
    if (!aggregated) {
      throw new Error("请求通知聚合失败");
    }
    notification = {
      id: aggregated.id,
      occurrenceCount: aggregated.occurrence_count,
    };
  } else {
    await tx.notification.createMany({
      data: [{ id: notificationId, ...input }],
    });
    notification = { id: notificationId, occurrenceCount: 1 };
  }
  await publishEvent(tx, {
    type: "NOTIFICATION_CREATED",
    userId: input.userId,
    customerSpaceId: input.customerSpaceId,
    projectId: input.projectId,
    serviceRequestId: input.serviceRequestId,
    payload: {
      notificationId: notification.id,
    },
  });
  return { ...input, ...notification };
}

export async function dispatchProjectActivity(
  tx: Prisma.TransactionClient,
  actor: Actor,
  input: {
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
    visibility: ContentVisibility;
    customerSpaceId: string;
    projectId: string;
  },
) {
  const audience = await loadProjectAudience(tx, input.projectId);
  return persistActivityDelivery(
    tx,
    planProjectActivity({
      actorId: actor.id,
      audience,
      ...input,
    }),
  );
}

export async function dispatchRequestActivity(
  tx: Prisma.TransactionClient,
  actor: Actor,
  input: {
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
    includeCustomers: boolean;
    relevantWorkerUserIds?: Array<string | null | undefined>;
    notifyProjectManagers: boolean;
    notifyPlatformAdmins: boolean;
    createNotifications?: boolean;
    customerSpaceId: string;
    projectId: string;
    serviceRequestId: string;
  },
) {
  const audience = await loadProjectAudience(tx, input.projectId);
  return persistActivityDelivery(
    tx,
    planRequestActivity({
      actorId: actor.id,
      audience,
      ...input,
    }),
  );
}

export function requestStatusLabel(status: RequestStatus) {
  const labels: Record<RequestStatus, string> = {
    PENDING: "待处理",
    IN_PROGRESS: "处理中",
    WAITING_CUSTOMER: "等待客户回复",
    RESOLVED: "已解决",
    CLOSED: "已关闭",
  };
  return labels[status];
}

export function listNotifications(actor: Actor, limit = 30) {
  return withActorDb(actor, (tx) =>
    tx.notification.findMany({
      where: { userId: actor.id },
      orderBy: { updatedAt: "desc" },
      take: Math.min(limit, 100),
    }),
  );
}

export function markNotificationRead(actor: Actor, notificationId: string) {
  return withActorDb(actor, (tx) =>
    tx.notification.updateMany({
      where: { id: notificationId, userId: actor.id },
      data: { readAt: new Date(), aggregationKey: null },
    }),
  );
}

export function markAllNotificationsRead(actor: Actor) {
  return withActorDb(actor, (tx) =>
    tx.notification.updateMany({
      where: { userId: actor.id, readAt: null },
      data: { readAt: new Date(), aggregationKey: null },
    }),
  );
}

export function markRequestNotificationsRead(
  actor: Actor,
  serviceRequestId: string,
) {
  return withActorDb(actor, (tx) =>
    tx.notification.updateMany({
      where: {
        userId: actor.id,
        serviceRequestId,
        readAt: null,
      },
      data: { readAt: new Date(), aggregationKey: null },
    }),
  );
}

export function markProjectNotificationsRead(
  actor: Actor,
  projectId: string,
  scope: "updates" | "all" = "updates",
) {
  return withActorDb(actor, (tx) =>
    tx.notification.updateMany({
      where: {
        userId: actor.id,
        projectId,
        readAt: null,
        ...(scope === "updates"
          ? {
              type: {
                in: ["PROJECT_UPDATE", "UPDATE_COMMENT"],
              },
            }
          : {}),
      },
      data: { readAt: new Date(), aggregationKey: null },
    }),
  );
}

export function listVisibleEvents(actor: Actor, afterId: bigint, limit = 100) {
  return withActorDb(actor, async (tx) => {
    const events = await tx.eventRecord.findMany({
      where: {
        id: { gt: afterId },
        OR: [
          { userId: actor.id },
          { userId: null },
          ...(actor.isPlatformAdmin ? [{}] : []),
        ],
      },
      orderBy: { id: "asc" },
      take: limit,
    });
    const visibleEvents = actor.isPlatformAdmin
      ? events
      : await filterVisibleEvents(tx, actor, events);

    return visibleEvents.map((event) => ({
      ...event,
      id: event.id.toString(),
    }));
  });
}

async function filterVisibleEvents(
  tx: Prisma.TransactionClient,
  actor: Actor,
  events: Awaited<
    ReturnType<Prisma.TransactionClient["eventRecord"]["findMany"]>
  >,
) {
  const requestIds = uniqueStrings(
    events.map((event) => event.serviceRequestId),
  );
  const projectIds = uniqueStrings(events.map((event) => event.projectId));
  const customerSpaceIds = uniqueStrings(
    events.map((event) => event.customerSpaceId),
  );
  const requests = await tx.serviceRequest.findMany({
    where: { id: { in: requestIds } },
    select: {
      id: true,
      projectId: true,
      project: { select: { customerSpaceId: true } },
    },
  });
  const projects = await tx.project.findMany({
    where: { id: { in: projectIds } },
    select: { id: true, customerSpaceId: true },
  });
  const customerSpaces = await tx.customerSpace.findMany({
    where: { id: { in: customerSpaceIds } },
    select: { id: true },
  });
  const requestScope = new Map(
    requests.map((request) => [
      request.id,
      {
        projectId: request.projectId,
        customerSpaceId: request.project.customerSpaceId,
      },
    ]),
  );
  const projectScope = new Map(
    projects.map((project) => [project.id, project.customerSpaceId]),
  );
  const visibleCustomerSpaceIds = new Set(
    customerSpaces.map((space) => space.id),
  );

  return events.filter((event) => {
    if (!actor.isStaff && hasInternalVisibility(event.payload)) {
      return false;
    }

    if (event.serviceRequestId) {
      const scope = requestScope.get(event.serviceRequestId);
      return Boolean(
        scope &&
          (!event.projectId || event.projectId === scope.projectId) &&
          (!event.customerSpaceId ||
            event.customerSpaceId === scope.customerSpaceId),
      );
    }
    if (event.projectId) {
      const customerSpaceId = projectScope.get(event.projectId);
      return Boolean(
        customerSpaceId &&
          (!event.customerSpaceId ||
            event.customerSpaceId === customerSpaceId),
      );
    }
    if (event.customerSpaceId) {
      return visibleCustomerSpaceIds.has(event.customerSpaceId);
    }

    return event.userId === actor.id;
  });
}

async function loadProjectAudience(
  tx: Prisma.TransactionClient,
  projectId: string,
): Promise<ActivityAudience> {
  const project = await tx.project.findUniqueOrThrow({
    where: { id: projectId },
    select: {
      customerSpace: {
        select: {
          memberships: {
            select: { userId: true },
          },
        },
      },
      staff: {
        select: { userId: true, role: true },
      },
    },
  });
  const platformAdmins = await tx.user.findMany({
    where: { platformRole: "PLATFORM_ADMIN" },
    select: { id: true },
  });

  return {
    customerUserIds: project.customerSpace.memberships.map(
      (membership) => membership.userId,
    ),
    projectStaffUserIds: project.staff.map((staff) => staff.userId),
    projectManagerUserIds: project.staff
      .filter((staff) => staff.role === "PROJECT_MANAGER")
      .map((staff) => staff.userId),
    platformAdminUserIds: platformAdmins.map((admin) => admin.id),
  };
}

async function persistActivityDelivery(
  tx: Prisma.TransactionClient,
  delivery: ActivityDelivery,
) {
  const events = [];
  const notifications = [];

  for (const event of delivery.events) {
    events.push(await publishEvent(tx, event));
  }
  const requestId = delivery.notifications.find(
    (notification) => notification.serviceRequestId,
  )?.serviceRequestId;
  const activeUserIds = new Set(
    requestId && delivery.notifications.length > 0
      ? (
          await tx.requestPresence.findMany({
            where: {
              serviceRequestId: requestId,
              userId: {
                in: delivery.notifications.map(
                  (notification) => notification.userId,
                ),
              },
              expiresAt: { gt: new Date() },
            },
            select: { userId: true },
          })
        ).map((presence) => presence.userId)
      : [],
  );
  for (const notification of delivery.notifications) {
    if (activeUserIds.has(notification.userId)) continue;
    notifications.push(await createNotification(tx, notification));
  }

  return { events, notifications };
}

function hasInternalVisibility(payload: Prisma.JsonValue) {
  return (
    typeof payload === "object" &&
    payload !== null &&
    !Array.isArray(payload) &&
    payload.visibility === "INTERNAL"
  );
}

function uniqueStrings(values: Array<string | null>) {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}
