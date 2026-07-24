import "server-only";

import { randomUUID } from "node:crypto";
import {
  Prisma,
  type ContentVisibility,
  type EventType,
  type NotificationType,
  type RequestStatus,
} from "@/generated/prisma/client";
import type { Actor } from "@/lib/actor";
import type { ExternalActor } from "@/lib/external-actor";
import { withActorDb } from "@/lib/actor";
import { withSystemDb } from "@/lib/system-db";
import {
  planProjectActivity,
  planRequestActivity,
  type ActivityAudience,
  type ActivityDelivery,
} from "@/modules/notifications/activity-delivery";
import {
  isProjectChangeAudible,
  isRequestChangeAudible,
  planDingTalkRequestEvent,
  planStandardRequestEmailRecipientIds,
  PROJECT_UPDATE_NOTIFICATION_TYPES,
} from "@/modules/notifications/activity-policy";
import {
  toNotificationPersistenceInput,
  type NotificationPersistenceInput,
} from "@/modules/notifications/notification-persistence";
import { summarizeUnreadNotificationGroups } from "@/modules/notifications/notification-summary";
import {
  canReceiveProjectRealtimeEvent,
  canReceiveRequestRealtimeEvent,
} from "@/modules/notifications/realtime-event-visibility";
import { loadNotificationDeliveryRule } from "@/modules/notifications/notification-delivery-rule-service";
import {
  resolveNotificationSoundEnabled,
  ruleKeyForProjectNotification,
  ruleKeyForRequestActivity,
} from "@/modules/notifications/notification-delivery-rules";
import { recordUniversalRequestWebhook } from "@/modules/integrations/universal/webhook-service";
import { recordDingTalkRobotDelivery } from "@/modules/plugins/dingtalk-robot-service";
import { notificationEmailDueAt } from "@/modules/notifications/notification-email-timing";
import { listProjectCustomerUserIds } from "@/modules/projects/project-customer-recipient-query";
import type { DeliveryFeedback } from "@/lib/operation-feedback";

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
  userIds?: string[];
  externalContactIds?: string[];
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
  const userIds = uniqueStrings(input.userIds ?? []);
  const externalContactIds = uniqueStrings(input.externalContactIds ?? []);
  if (userIds.length === 0 && externalContactIds.length === 0) return null;

  const chunkCount = Math.max(
    1,
    Math.ceil(userIds.length / 100),
    Math.ceil(externalContactIds.length / 100),
  );
  for (let index = 0; index < chunkCount; index += 1) {
    const envelope = JSON.stringify({
      type: input.type,
      userIds: userIds.slice(index * 100, index * 100 + 100),
      externalContactIds: externalContactIds.slice(
        index * 100,
        index * 100 + 100,
      ),
      payload: input.payload,
    });
    if (Buffer.byteLength(envelope, "utf8") > 7_000) {
      throw new Error("实时临时事件内容过大");
    }
    await tx.$executeRaw`
      SELECT pg_notify('service_platform_transient_events', ${envelope})
    `;
  }
  return { ...input, userIds, externalContactIds };
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
      audible: isProjectChangeAudible(input.change),
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
      audible: isRequestChangeAudible(input.change),
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
          audible: isProjectChangeAudible(input.change),
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
  input: NotificationPersistenceInput,
) {
  const notificationId = randomUUID();
  let notification: {
    id: string;
    occurrenceCount: number;
  };
  if (
    input.aggregationKey &&
    !input.sourceId &&
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
        ${input.aggregationKey},
        (
          ${input.emailDueAt?.toISOString() ?? null}::timestamptz
          AT TIME ZONE 'UTC'
        )
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
      data: [
        {
          id: notificationId,
          type: input.type,
          title: input.title,
          body: input.body,
          userId: input.userId,
          customerSpaceId: input.customerSpaceId,
          projectId: input.projectId,
          serviceRequestId: input.serviceRequestId,
          sourceType: input.sourceType,
          sourceId: input.sourceId,
          aggregationKey: input.aggregationKey,
          emailDueAt: input.emailDueAt,
        },
      ],
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
      "PROJECT_UPDATED" | "PROJECT_UPDATE_CREATED" | "UPDATE_COMMENT_CREATED"
    >;
    eventPayload: Prisma.InputJsonValue;
    notificationType: Extract<
      NotificationType,
      | "PROJECT_UPDATE"
      | "UPDATE_COMMENT"
      | "PROJECT_STAGE"
      | "PROJECT_MILESTONE"
      | "PROJECT_FILE"
    >;
    notificationTitle: string;
    notificationBody: string;
    visibility: ContentVisibility;
    customerSpaceId: string;
    projectId: string;
    contentRiskReviewId?: string;
  },
) {
  const audience = await loadProjectAudience(tx, input.projectId);
  const project = await tx.project.findUniqueOrThrow({
    where: { id: input.projectId },
    select: {
      customerUpdatesEnabled: true,
      customerFilesEnabled: true,
      showMilestones: true,
      showProgress: true,
    },
  });
  const customerFeatureEnabled =
    input.notificationType === "PROJECT_FILE"
      ? project.customerFilesEnabled
      : input.notificationType === "PROJECT_MILESTONE"
        ? project.showMilestones || project.showProgress
        : input.notificationType === "PROJECT_STAGE"
          ? project.showProgress
          : project.customerUpdatesEnabled;
  const visibility =
    input.visibility === "CUSTOMER_VISIBLE" &&
    !customerFeatureEnabled
      ? "INTERNAL"
      : input.visibility;
  const rule = await loadNotificationDeliveryRule(
    tx,
    ruleKeyForProjectNotification(input.notificationType),
  );
  const delivery = planProjectActivity({
    actorId: actor.id,
    audience,
    ...input,
    eventPayload: withAudiblePayload(input.eventPayload, rule.soundEnabled),
    visibility,
    emailRecipientUserIds:
      visibility === "CUSTOMER_VISIBLE" && rule.emailEnabled
        ? audience.customerUserIds
        : [],
  });
  if (!rule.notificationEnabled) delivery.notifications = [];
  return persistActivityDelivery(tx, delivery, {
    contentRiskReviewId: input.contentRiskReviewId,
  });
}

export async function dispatchProjectCreatedActivity(
  tx: Prisma.TransactionClient,
  actor: Actor,
  input: {
    customerSpaceId: string;
    projectId: string;
    projectTitle: string;
    standardProject: boolean;
  },
) {
  const audience = await loadProjectAudience(tx, input.projectId);
  const rule = await loadNotificationDeliveryRule(tx, "PROJECT_CREATED");
  const delivery = planProjectActivity({
    actorId: actor.id,
    audience,
    visibility: "CUSTOMER_VISIBLE",
    eventType: "PROJECT_UPDATED",
    eventPayload: {
      change: "PROJECT_CREATED",
      actorId: actor.id,
      audible: rule.soundEnabled,
      projectId: input.projectId,
    },
    notificationType: "PROJECT_CREATED",
    notificationTitle: `新项目：${input.projectTitle}`,
    notificationBody: `“${input.projectTitle}”已创建，请查看项目资料与后续进展。`,
    customerSpaceId: input.customerSpaceId,
    projectId: input.projectId,
    staffAudience: "PROJECT_MANAGERS",
    emailRecipientUserIds:
      input.standardProject && rule.emailEnabled
        ? [
            ...audience.customerUserIds,
            ...audience.projectManagerUserIds,
          ]
        : [],
  });
  if (!rule.notificationEnabled) delivery.notifications = [];
  return persistActivityDelivery(tx, delivery);
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
    includeCustomers: boolean;
    relevantWorkerUserIds?: Array<string | null | undefined>;
    emailWorkerUserIds?: Array<string | null | undefined>;
    notifyProjectManagers: boolean;
    notifyPlatformAdmins: boolean;
    createNotifications?: boolean;
    audible?: boolean;
    eventAudience?: "DEFAULT" | "NOTIFICATION_RECIPIENTS";
    includeExternalContact?: boolean;
    customerSpaceId: string;
    projectId: string;
    serviceRequestId: string;
    sourceType?: string;
    sourceId?: string;
    contentRiskReviewId?: string;
  },
) {
  const audience = await loadProjectAudience(tx, input.projectId);
  const project = await tx.project.findUniqueOrThrow({
    where: { id: input.projectId },
    select: { customerRequestsEnabled: true, kind: true },
  });
  const includeCustomers =
    input.includeCustomers && project.customerRequestsEnabled;
  const validWorkerUserIds = new Set([
    ...audience.projectStaffUserIds,
    ...audience.platformAdminUserIds,
  ]);
  const relevantWorkerUserIds = uniqueStrings(
    input.relevantWorkerUserIds ?? [],
  ).filter((userId) => validWorkerUserIds.has(userId));
  const emailWorkerUserIds = uniqueStrings(
    input.emailWorkerUserIds ?? [],
  ).filter((userId) => validWorkerUserIds.has(userId));
  const payload = jsonObject(input.eventPayload);
  const rule = await loadNotificationDeliveryRule(
    tx,
    ruleKeyForRequestActivity({
      notificationType: input.notificationType,
      visibility:
        typeof payload.visibility === "string" ? payload.visibility : undefined,
    }),
  );
  const createNotifications =
    input.createNotifications !== false && rule.notificationEnabled;
  const emailRecipientUserIds =
    project.kind === "STANDARD" && createNotifications && rule.emailEnabled
      ? standardRequestEmailRecipients(
          actor,
          {
            ...input,
            relevantWorkerUserIds,
            emailWorkerUserIds,
          },
          audience,
          includeCustomers,
        )
      : [];
  const delivery = await persistActivityDelivery(
    tx,
    planRequestActivity({
      actorId: actor.id,
      audience,
      ...input,
      relevantWorkerUserIds,
      eventPayload: withAudiblePayload(
        input.eventPayload,
        resolveNotificationSoundEnabled(rule.soundEnabled, input.audible),
      ),
      includeCustomers,
      createNotifications,
      emailRecipientUserIds,
    }),
    { contentRiskReviewId: input.contentRiskReviewId },
  );
  if (input.includeExternalContact) {
    // Embed-only copy: explicitly marked so main-app SSE can ignore it without
    // dropping legitimate userId=null request events.
    delivery.events.push(
      await publishEvent(tx, {
        type: input.eventType,
        payload: withExternalEmbedAudience(
          withAudiblePayload(input.eventPayload, input.audible ?? true),
        ),
        customerSpaceId: input.customerSpaceId,
        projectId: input.projectId,
        serviceRequestId: input.serviceRequestId,
      }),
    );
  }
  if (
    input.eventType === "REQUEST_CREATED" ||
    input.eventType === "REQUEST_MESSAGE_CREATED" ||
    input.eventType === "REQUEST_STATUS_CHANGED"
  ) {
    await recordUniversalRequestWebhook(tx, {
      eventType: input.eventType,
      eventPayload: input.eventPayload,
      serviceRequestId: input.serviceRequestId,
    });
  }
  const dingtalkQueued = await recordDingTalkRequestActivity(tx, actor, input, payload, {
    enabled: rule.dingtalkEnabled,
    customerActor: actor.platformRole === "CUSTOMER",
    contentRiskReviewId: input.contentRiskReviewId,
  });
  delivery.feedback.dingtalkQueued = dingtalkQueued;
  return delivery;
}

export async function dispatchExternalRequestActivity(
  tx: Prisma.TransactionClient,
  actor: ExternalActor,
  input: {
    eventType: Extract<
      EventType,
      | "REQUEST_CREATED"
      | "REQUEST_MESSAGE_CREATED"
      | "REQUEST_STATUS_CHANGED"
      | "REQUEST_UPDATED"
    >;
    eventPayload: Prisma.InputJsonValue;
    notificationType: Extract<
      NotificationType,
      | "REQUEST_CREATED"
      | "REQUEST_MESSAGE"
      | "REQUEST_STATUS"
      | "REQUEST_ATTACHMENT"
    >;
    notificationTitle: string;
    notificationBody: string;
    includeCustomers: boolean;
    createNotifications?: boolean;
    audible?: boolean;
    relevantWorkerUserIds?: Array<string | null | undefined>;
    notifyProjectManagers: boolean;
    notifyPlatformAdmins: boolean;
    customerSpaceId: string;
    projectId: string;
    serviceRequestId: string;
    sourceType?: string;
    sourceId?: string;
    contentRiskReviewId?: string;
  },
) {
  const projectContext = await withSystemDb(async (systemTx) => ({
    audience: await loadProjectAudience(systemTx, input.projectId),
    project: await systemTx.project.findUniqueOrThrow({
      where: { id: input.projectId },
      select: { customerRequestsEnabled: true },
    }),
  }));
  const payload = jsonObject(input.eventPayload);
  const rule = await loadNotificationDeliveryRule(
    tx,
    ruleKeyForRequestActivity({
      notificationType: input.notificationType,
      visibility:
        typeof payload.visibility === "string" ? payload.visibility : undefined,
    }),
  );
  const delivery = await persistActivityDelivery(
    tx,
    planRequestActivity({
      actorId: "",
      audience: projectContext.audience,
      ...input,
      eventPayload: withAudiblePayload(
        input.eventPayload,
        resolveNotificationSoundEnabled(rule.soundEnabled, input.audible),
      ),
      createNotifications:
        input.createNotifications !== false && rule.notificationEnabled,
      includeCustomers:
        input.includeCustomers &&
        projectContext.project.customerRequestsEnabled,
    }),
    { contentRiskReviewId: input.contentRiskReviewId },
  );
  // Embed multi-tab sync: external contacts only see userId=null request events.
  delivery.events.push(
    await publishEvent(tx, {
      type: input.eventType,
      payload: withExternalEmbedAudience(
        withAudiblePayload(input.eventPayload, input.audible ?? true),
      ),
      customerSpaceId: input.customerSpaceId,
      projectId: input.projectId,
      serviceRequestId: input.serviceRequestId,
    }),
  );
  if (
    input.eventType === "REQUEST_CREATED" ||
    input.eventType === "REQUEST_MESSAGE_CREATED" ||
    input.eventType === "REQUEST_STATUS_CHANGED"
  ) {
    await recordUniversalRequestWebhook(tx, {
      eventType: input.eventType,
      eventPayload: input.eventPayload,
      serviceRequestId: input.serviceRequestId,
    });
  }
  const dingtalkQueued = await recordDingTalkRequestActivity(tx, actor, input, payload, {
    enabled: rule.dingtalkEnabled,
    customerActor: true,
    contentRiskReviewId: input.contentRiskReviewId,
  });
  delivery.feedback.dingtalkQueued = dingtalkQueued;
  return delivery;
}

async function recordDingTalkRequestActivity(
  tx: Prisma.TransactionClient,
  actor: Pick<Actor, "name"> | Pick<ExternalActor, "name">,
  input: {
    eventType: string;
    serviceRequestId: string;
    notificationBody: string;
  },
  payload: Prisma.InputJsonObject,
  options: {
    enabled: boolean;
    customerActor: boolean;
    contentRiskReviewId?: string;
  },
) {
  const delivery = planDingTalkRequestEvent({
    enabled: options.enabled,
    eventType: input.eventType,
    requestId: input.serviceRequestId,
    messageId:
      typeof payload.messageId === "string" ? payload.messageId : undefined,
    visibility:
      typeof payload.visibility === "string" ? payload.visibility : undefined,
    customerActor: options.customerActor,
    actorName: actor.name,
    contentSummary: input.notificationBody,
    occurredAt:
      typeof payload.occurredAt === "string" ? payload.occurredAt : undefined,
  });
  if (!delivery) return false;
  await recordDingTalkRobotDelivery(tx, {
    ...delivery,
    contentRiskReviewId: options.contentRiskReviewId,
  });
  return true;
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

function withAudiblePayload(
  payload: Prisma.InputJsonValue,
  audible = true,
): Prisma.InputJsonValue {
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    return { ...(payload as Prisma.InputJsonObject), audible };
  }
  return { value: payload, audible };
}

function jsonObject(payload: Prisma.InputJsonValue) {
  return payload && typeof payload === "object" && !Array.isArray(payload)
    ? (payload as Prisma.InputJsonObject)
    : {};
}

function standardRequestEmailRecipients(
  actor: Actor,
  input: {
    eventType: EventType;
    notificationType: NotificationType;
    eventPayload: Prisma.InputJsonValue;
    relevantWorkerUserIds?: Array<string | null | undefined>;
    emailWorkerUserIds?: Array<string | null | undefined>;
  },
  audience: ActivityAudience,
  includeCustomers: boolean,
) {
  const payload =
    input.eventPayload &&
    typeof input.eventPayload === "object" &&
    !Array.isArray(input.eventPayload)
      ? (input.eventPayload as Prisma.InputJsonObject)
      : {};

  return planStandardRequestEmailRecipientIds({
    actorId: actor.id,
    actorPlatformRole: actor.platformRole,
    eventType: input.eventType,
    notificationType: input.notificationType,
    visibility:
      typeof payload.visibility === "string" ? payload.visibility : undefined,
    status: typeof payload.status === "string" ? payload.status : undefined,
    includeCustomers,
    customerUserIds: audience.customerUserIds,
    projectManagerUserIds: audience.projectManagerUserIds,
    platformAdminUserIds: audience.platformAdminUserIds,
    relevantWorkerUserIds: input.relevantWorkerUserIds,
    emailWorkerUserIds: input.emailWorkerUserIds,
  });
}

export function listNotifications(
  actor: Actor,
  options: { limit?: number; cursor?: string } = {},
) {
  const limit = Math.min(Math.max(options.limit ?? 30, 1), 100);
  const cursor = decodeNotificationCursor(options.cursor);
  return withActorDb(actor, async (tx) => {
    const items = await tx.notification.findMany({
      where: {
        userId: actor.id,
        ...(cursor
          ? {
              OR: [
                { updatedAt: { lt: cursor.updatedAt } },
                {
                  updatedAt: cursor.updatedAt,
                  id: { lt: cursor.id },
                },
              ],
            }
          : {}),
      },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: limit + 1,
    });
    const totalUnread = await tx.notification.count({
      where: { userId: actor.id, readAt: null },
    });
    const hasMore = items.length > limit;
    const pageItems = hasMore ? items.slice(0, limit) : items;
    const last = pageItems.at(-1);
    return {
      items: pageItems,
      totalUnread,
      nextCursor:
        hasMore && last
          ? encodeNotificationCursor(last.updatedAt, last.id)
          : null,
    };
  });
}

export function getNotificationSummary(actor: Actor) {
  return withActorDb(actor, async (tx) => {
    const unread = await tx.notification.groupBy({
      by: ["type", "projectId", "serviceRequestId"],
      where: { userId: actor.id, readAt: null },
      _count: { _all: true },
    });
    return summarizeUnreadNotificationGroups(unread);
  });
}

function encodeNotificationCursor(updatedAt: Date, id: string) {
  return Buffer.from(`${updatedAt.toISOString()}\n${id}`, "utf8").toString(
    "base64url",
  );
}

function decodeNotificationCursor(value?: string) {
  if (!value) return null;
  try {
    const [updatedAtValue, id] = Buffer.from(value, "base64url")
      .toString("utf8")
      .split("\n");
    const updatedAt = new Date(updatedAtValue);
    if (!id || Number.isNaN(updatedAt.getTime())) return null;
    return { updatedAt, id };
  } catch {
    return null;
  }
}

export function markNotificationRead(actor: Actor, notificationId: string) {
  return markNotificationsRead(actor, { id: notificationId });
}

export function markAllNotificationsRead(actor: Actor) {
  return markNotificationsRead(actor, {});
}

export function markRequestNotificationsRead(
  actor: Actor,
  serviceRequestId: string,
) {
  return markNotificationsRead(actor, { serviceRequestId });
}

export function markProjectNotificationsRead(
  actor: Actor,
  projectId: string,
  scope: "overview" | "updates" | "milestones" | "files" | "all" = "updates",
) {
  const typesByScope: Record<Exclude<typeof scope, "all">, NotificationType[]> = {
    overview: ["PROJECT_CREATED", "PROJECT_STAGE"],
    updates: PROJECT_UPDATE_NOTIFICATION_TYPES,
    milestones: ["PROJECT_MILESTONE"],
    files: ["PROJECT_FILE"],
  };
  return markNotificationsRead(actor, {
    projectId,
    ...(scope === "all" ? {} : { type: { in: typesByScope[scope] } }),
  });
}

function markNotificationsRead(
  actor: Actor,
  scope: Prisma.NotificationWhereInput,
) {
  return withActorDb(actor, async (tx) => {
    const ownedScope: Prisma.NotificationWhereInput = {
      userId: actor.id,
      ...scope,
      readAt: null,
    };
    let count = 0;
    while (true) {
      const notifications = await tx.notification.findMany({
        where: ownedScope,
        select: { id: true },
        orderBy: { id: "asc" },
        take: 500,
      });
      if (notifications.length === 0) break;
      const notificationIds = notifications.map(
        (notification) => notification.id,
      );
      const idValues = notificationIds.map((id) => Prisma.sql`${id}`);
      await tx.$executeRaw(
        Prisma.sql`
          SELECT app_cancel_notification_mail_for_ids(
            ARRAY[${Prisma.join(idValues)}]::text[],
            '用户已阅读对应通知'
          )
        `,
      );
      const updated = await tx.notification.updateMany({
        where: {
          id: { in: notificationIds },
          userId: actor.id,
          readAt: null,
        },
        data: {
          readAt: new Date(),
          aggregationKey: null,
          emailDueAt: null,
          emailClaimedAt: null,
        },
      });
      count += updated.count;
    }
    return { count };
  });
}

const EXTERNAL_EMBED_AUDIENCE = "EXTERNAL_EMBED";

function withExternalEmbedAudience(
  payload: Prisma.InputJsonValue,
): Prisma.InputJsonValue {
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    return {
      ...(payload as Prisma.InputJsonObject),
      audience: EXTERNAL_EMBED_AUDIENCE,
    };
  }
  return {
    value: payload,
    audience: EXTERNAL_EMBED_AUDIENCE,
  };
}

function isExternalEmbedAudienceEvent(payload: Prisma.JsonValue) {
  return (
    typeof payload === "object" &&
    payload !== null &&
    !Array.isArray(payload) &&
    (payload as { audience?: unknown }).audience === EXTERNAL_EMBED_AUDIENCE
  );
}

export async function listVisibleEventBatch(
  actor: Actor,
  afterId: bigint,
  limit = 100,
) {
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
    const nextCursor = events.at(-1)?.id ?? afterId;
    // Only drop embed-dedicated copies. Legitimate userId=null request
    // events (and attachments/presence) must still reach the main app.
    const withoutEmbedOnlyCopies = events.filter(
      (event) =>
        !(
          event.userId === null &&
          isExternalEmbedAudienceEvent(event.payload)
        ),
    );
    const visibleEvents = actor.isPlatformAdmin
      ? withoutEmbedOnlyCopies
      : await filterVisibleEvents(tx, actor, withoutEmbedOnlyCopies);

    return {
      events: visibleEvents.map((event) => ({
        ...event,
        id: event.id.toString(),
      })),
      nextCursor,
      scannedCount: events.length,
    };
  });
}

export async function listVisibleEvents(
  actor: Actor,
  afterId: bigint,
  limit = 100,
) {
  return (await listVisibleEventBatch(actor, afterId, limit)).events;
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
      project: {
        select: {
          customerSpaceId: true,
          customerRequestsEnabled: true,
        },
      },
    },
  });
  const projects = await tx.project.findMany({
    where: { id: { in: projectIds } },
    select: {
      id: true,
      customerSpaceId: true,
      customerUpdatesEnabled: true,
      customerFilesEnabled: true,
      showMilestones: true,
      showProgress: true,
    },
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
        customerRequestsEnabled:
          request.project.customerRequestsEnabled,
      },
    ]),
  );
  const projectScope = new Map(
    projects.map((project) => [
      project.id,
      {
        customerSpaceId: project.customerSpaceId,
        customerUpdatesEnabled: project.customerUpdatesEnabled,
        customerFilesEnabled: project.customerFilesEnabled,
        showMilestones: project.showMilestones,
        showProgress: project.showProgress,
      },
    ]),
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
          canReceiveRequestRealtimeEvent(
            actor.isStaff,
            scope.customerRequestsEnabled,
          ) &&
          (!event.projectId || event.projectId === scope.projectId) &&
          (!event.customerSpaceId ||
            event.customerSpaceId === scope.customerSpaceId),
      );
    }
    if (event.projectId) {
      const scope = projectScope.get(event.projectId);
      if (!scope) return false;
      if (!canReceiveProjectRealtimeEvent({
        isStaff: actor.isStaff,
        type: event.type,
        payload: event.payload,
        customerUpdatesEnabled: scope.customerUpdatesEnabled,
        customerFilesEnabled: scope.customerFilesEnabled,
        showMilestones: scope.showMilestones,
        showProgress: scope.showProgress,
      })) {
        return false;
      }
      return Boolean(
        !event.customerSpaceId ||
          event.customerSpaceId === scope.customerSpaceId,
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
      staff: {
        select: { userId: true, role: true },
      },
    },
  });
  const customerUserIds = await listProjectCustomerUserIds(tx, projectId);
  const platformAdmins = await tx.user.findMany({
    where: { platformRole: "PLATFORM_ADMIN" },
    select: { id: true },
  });

  return {
    customerUserIds,
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
  options?: { contentRiskReviewId?: string },
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
  const emailCandidateUserIds = uniqueStrings(
    delivery.notifications
      .filter((notification) => notification.emailEligible)
      .map((notification) => notification.userId),
  );
  const emailEnabledUserIds = new Set<string>();
  let delayEmailUntilUnread = false;
  if (emailCandidateUserIds.length > 0) {
    const [settings] = await tx.$queryRaw<
      Array<{
        mail_mode: "LOCAL_OUTBOX" | "RESEND" | "SMTP";
        delay_enabled: boolean;
      }>
    >`
      SELECT mail_mode, delay_enabled
      FROM app_notification_mail_runtime_settings()
    `;
    const users = await tx.user.findMany({
      where: { id: { in: emailCandidateUserIds } },
      select: { id: true, requestEmailNotificationsEnabled: true },
    });
    if (settings && settings.mail_mode !== "LOCAL_OUTBOX") {
      delayEmailUntilUnread = settings?.delay_enabled ?? false;
      for (const user of users) {
        if (user.requestEmailNotificationsEnabled) {
          emailEnabledUserIds.add(user.id);
        }
      }
    }
  }
  const emailDueAt = notificationEmailDueAt(delayEmailUntilUnread);
  let immediateMailNotificationId: string | null = null;
  let emailCount = 0;
  for (const notification of delivery.notifications) {
    if (
      !options?.contentRiskReviewId &&
      activeUserIds.has(notification.userId)
    ) {
      continue;
    }
    const notificationEmailDueAt = emailEnabledUserIds.has(notification.userId)
      ? emailDueAt
      : undefined;
    const persistenceInput = toNotificationPersistenceInput(
      notification,
      options?.contentRiskReviewId ? undefined : notificationEmailDueAt,
    );
    const persistedNotification = await createNotification(
      tx,
      options?.contentRiskReviewId
        ? { ...persistenceInput, aggregationKey: undefined }
        : persistenceInput,
    );
    if (options?.contentRiskReviewId) {
      const [held] = await tx.$queryRaw<Array<{ held: boolean }>>`
        SELECT app_hold_notification_for_content_risk(
          ${persistedNotification.id},
          ${options.contentRiskReviewId},
          ${notificationEmailDueAt ?? null}
        ) AS held
      `;
      if (!held?.held) throw new Error("风控通知暂缓失败");
    }
    notifications.push(persistedNotification);
    if (notificationEmailDueAt) emailCount += 1;
    if (
      notificationEmailDueAt &&
      !delayEmailUntilUnread &&
      !options?.contentRiskReviewId
    ) {
      immediateMailNotificationId ??= persistedNotification.id;
    }
  }
  if (immediateMailNotificationId) {
    await tx.$executeRaw`
      SELECT pg_notify(
        'service_platform_mail_outbox',
        ${immediateMailNotificationId}
      )
    `;
  }

  const feedback: DeliveryFeedback = {
    notificationCount: notifications.length,
    emailCount,
    emailTiming:
      emailCount === 0
        ? null
        : delayEmailUntilUnread
          ? "DELAYED"
          : "IMMEDIATE",
    dingtalkQueued: false,
  };

  return { events, notifications, feedback };
}

function hasInternalVisibility(payload: Prisma.JsonValue) {
  return (
    typeof payload === "object" &&
    payload !== null &&
    !Array.isArray(payload) &&
    payload.visibility === "INTERNAL"
  );
}

function uniqueStrings(values: Array<string | null | undefined>) {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}
