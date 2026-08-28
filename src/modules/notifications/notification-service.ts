import "server-only";

import { randomUUID } from "node:crypto";
import { recordWechatSubscribeDelivery } from "@/modules/miniapp/wechat-subscribe-message-service";
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
  planProjectStaffActivity,
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
import { writeAuditLog } from "@/modules/audit/audit-service";
import { loadNotificationDeliveryRule } from "@/modules/notifications/notification-delivery-rule-service";
import {
  applyDeliveryExclusions,
  isDeliveryOverrideEffective,
  isEmailForced,
  resolveDeliveryChannel,
  sanitizeDeliveryOverride,
  type DeliveryOverrideEffect,
  type NotificationDeliveryOverride,
} from "@/modules/notifications/notification-delivery-override";
import {
  NOTIFICATION_DELIVERY_RULES,
  resolveNotificationSoundEnabled,
  ruleKeyForNotificationEmail,
  ruleKeyForProjectNotification,
  ruleKeyForRequestActivity,
  type NotificationDeliveryRuleKey,
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
  options?: { wechatOverride?: boolean },
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
          aggregationKey: input.sourceId ? undefined : input.aggregationKey,
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
  // 微信订阅消息（提醒渠道）：入队失败不影响通知本身
  await recordWechatSubscribeDelivery(tx, {
    wechatOverride: options?.wechatOverride,
    id: notification.id,
    occurrenceCount: notification.occurrenceCount,
    type: input.type,
    title: input.title,
    body: input.body,
    userId: input.userId,
    projectId: input.projectId ?? null,
    serviceRequestId: input.serviceRequestId ?? null,
  });
  return { ...input, ...notification };
}

/**
 * 只有真正改变了投递结果才落审计：点开自定义但什么都没改 → 不记。
 * 「谁的邮件退订被无视」是这条审计最关键的信息，必须逐人记下来。
 */
async function recordDeliveryOverrideAudit(
  tx: Prisma.TransactionClient,
  actor: Actor,
  input: {
    override?: NotificationDeliveryOverride;
    ruleKey: string;
    rule: {
      notificationEnabled: boolean;
      emailEnabled: boolean;
      wechatEnabled: boolean;
    };
    emailPreferenceOverriddenUserIds: string[];
    excludedUserIds: string[];
    customerSpaceId?: string;
    projectId?: string;
    serviceRequestId?: string;
  },
) {
  const override = input.override;
  const forcedChannels: DeliveryOverrideEffect["forcedChannels"] = [];
  const suppressedChannels: DeliveryOverrideEffect["suppressedChannels"] = [];
  const channels = [
    ["notification", override?.notification, input.rule.notificationEnabled],
    ["email", override?.email, input.rule.emailEnabled],
    ["wechat", override?.wechat, input.rule.wechatEnabled],
  ] as const;
  for (const [channel, chosen, ruleEnabled] of channels) {
    if (chosen === undefined || chosen === ruleEnabled) continue;
    if (chosen) forcedChannels.push(channel);
    else suppressedChannels.push(channel);
  }
  const effect: DeliveryOverrideEffect = {
    forcedChannels,
    suppressedChannels,
    emailPreferenceOverriddenUserIds: input.emailPreferenceOverriddenUserIds,
    excludedUserIds: input.excludedUserIds,
  };
  if (!isDeliveryOverrideEffective(effect)) return;
  await writeAuditLog(tx, actor, {
    action: "NOTIFICATION_DELIVERY_OVERRIDDEN",
    resourceType: "NotificationDeliveryRule",
    resourceId: input.ruleKey,
    customerSpaceId: input.customerSpaceId,
    projectId: input.projectId,
    serviceRequestId: input.serviceRequestId,
    metadata: {
      ruleKey: input.ruleKey,
      forcedChannels: effect.forcedChannels,
      suppressedChannels: effect.suppressedChannels,
      emailPreferenceOverriddenUserIds: effect.emailPreferenceOverriddenUserIds,
      excludedUserIds: effect.excludedUserIds,
    },
  });
}

type ProjectActivityRequest = {
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
  deliveryOverride?: NotificationDeliveryOverride;
};

/**
 * 算出这次项目活动的收件人与各通道开关。真正发送与「发送前预览」共用这里，
 * 避免收件人规则出现两份实现而漂移；预览只是把 deliveryOverride 留空来跑。
 */
async function resolveProjectActivityPlan(
  tx: Prisma.TransactionClient,
  actor: Actor,
  input: ProjectActivityRequest,
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
    input.visibility === "CUSTOMER_VISIBLE" && !customerFeatureEnabled
      ? "INTERNAL"
      : input.visibility;
  const ruleKey = ruleKeyForProjectNotification(input.notificationType);
  const rule = await loadNotificationDeliveryRule(tx, ruleKey);
  const override = sanitizeDeliveryOverride(
    actor,
    input.deliveryOverride,
    ruleChannelSupport(ruleKey),
  );
  const notificationEnabled = resolveDeliveryChannel(
    rule.notificationEnabled,
    override?.notification,
  );
  // 站内是载体：关掉它，邮件与微信一并失效
  const emailEnabled =
    notificationEnabled &&
    resolveDeliveryChannel(rule.emailEnabled, override?.email);
  const delivery = planProjectActivity({
    actorId: actor.id,
    audience,
    ...input,
    // 站内是载体：本次把它关掉（规则关的或本次覆盖关的）就不该还响铃 ——
    // 提示行写的是「本次操作不会发出提醒」，收件人却听得见，等于说话不算数
    eventPayload: withAudiblePayload(
      input.eventPayload,
      notificationEnabled && rule.soundEnabled,
    ),
    visibility,
    emailRecipientUserIds:
      visibility === "CUSTOMER_VISIBLE" && emailEnabled
        ? audience.customerUserIds
        : [],
  });
  if (!notificationEnabled) delivery.notifications = [];
  const excluded = applyDeliveryExclusions(delivery.notifications, override);
  delivery.notifications = excluded.notifications;
  return {
    delivery,
    ruleKey,
    rule,
    override,
    excludedUserIds: excluded.excludedUserIds,
  };
}

export async function dispatchProjectActivity(
  tx: Prisma.TransactionClient,
  actor: Actor,
  input: ProjectActivityRequest,
) {
  const { delivery, ruleKey, rule, override, excludedUserIds } =
    await resolveProjectActivityPlan(tx, actor, input);
  const persisted = await persistActivityDelivery(tx, delivery, {
    contentRiskReviewId: input.contentRiskReviewId,
    deliveryOverride: override,
  });
  await recordDeliveryOverrideAudit(tx, actor, {
    override,
    ruleKey,
    rule,
    emailPreferenceOverriddenUserIds: persisted.emailPreferenceOverriddenUserIds,
    excludedUserIds,
    customerSpaceId: input.customerSpaceId,
    projectId: input.projectId,
  });
  return persisted;
}

/**
 * 预览用的「全通道打开」覆盖。
 *
 * 预览不能沿用当前的通道开关：后台把站内或邮件关着时，收件人列表会被清空、
 * emailEligible 会全为 false，弹窗于是显示「0 人」或「本场景不发送」；可员工正是
 * 要在弹窗里把它强制打开，提交后真实发送又会把这些人算回来 —— 预览说没人收，
 * 结果批量发出去。所以预览要算的是「本场景的收件范围」这个不随开关变的底数，
 * 通道开关由弹窗自己按用户当前的勾选去渲染。
 *
 * 注意这里只放开通道开关。场景本身不支持的通道会被 sanitizeDeliveryOverride 丢掉，
 * 可见性、项目类型等收件范围维度也不受影响 —— 那些是强制发送本就越不过的边界。
 */
const PREVIEW_ALL_CHANNELS_ON = {
  notification: true,
  email: true,
  wechat: true,
} as const;

/** 发送前预览：跑一遍真正的收件人计算，但不落库；通道一律按打开算（见上） */
export async function previewProjectActivityRecipients(
  tx: Prisma.TransactionClient,
  actor: Actor,
  input: Omit<ProjectActivityRequest, "deliveryOverride" | "contentRiskReviewId">,
) {
  const { delivery, ruleKey } = await resolveProjectActivityPlan(tx, actor, {
    ...input,
    deliveryOverride: { ...PREVIEW_ALL_CHANNELS_ON },
  });
  return {
    ruleKey,
    notificationUserIds: delivery.notifications.map((item) => item.userId),
    emailUserIds: delivery.notifications
      .filter((item) => item.emailEligible)
      .map((item) => item.userId),
  };
}

/**
 * 项目人员变动（加入 / 角色调整 / 移出）只提醒当事人本人。
 *
 * 注意调用时机：移出项目必须在删除 ProjectStaff 行之前调用。Notification 的
 * RLS WITH CHECK 对非管理员要求 app_user_relevant_to_project(userId, projectId)，
 * 人一旦被删就不再「相关」，插入会被拒。
 */
async function resolveProjectStaffPlan(
  tx: Prisma.TransactionClient,
  actor: Actor,
  input: {
    change:
      | "PROJECT_STAFF_SELF_ADDED"
      | "PROJECT_STAFF_SELF_UPDATED"
      | "PROJECT_STAFF_SELF_REMOVED";
    recipientUserId: string;
    notificationTitle: string;
    notificationBody: string;
    customerSpaceId: string;
    projectId: string;
    deliveryOverride?: NotificationDeliveryOverride;
  },
) {
  const rule = await loadNotificationDeliveryRule(tx, "PROJECT_STAFF");
  const override = sanitizeDeliveryOverride(
    actor,
    input.deliveryOverride,
    ruleChannelSupport("PROJECT_STAFF"),
  );
  const notificationEnabled = resolveDeliveryChannel(
    rule.notificationEnabled,
    override?.notification,
  );
  const delivery = planProjectStaffActivity({
    actorId: actor.id,
    recipientUserId: input.recipientUserId,
    change: input.change,
    // 同上：站内关掉就不响铃
    audible: notificationEnabled && rule.soundEnabled,
    notificationTitle: input.notificationTitle,
    notificationBody: input.notificationBody,
    customerSpaceId: input.customerSpaceId,
    projectId: input.projectId,
    // 站内是载体：关掉它，邮件与微信一并失效
    emailEligible:
      notificationEnabled &&
      resolveDeliveryChannel(rule.emailEnabled, override?.email),
    notificationEnabled,
  });
  const excluded = applyDeliveryExclusions(delivery.notifications, override);
  delivery.notifications = excluded.notifications;
  return {
    delivery,
    rule,
    override,
    excludedUserIds: excluded.excludedUserIds,
  };
}

export async function dispatchProjectStaffActivity(
  tx: Prisma.TransactionClient,
  actor: Actor,
  input: {
    change:
      | "PROJECT_STAFF_SELF_ADDED"
      | "PROJECT_STAFF_SELF_UPDATED"
      | "PROJECT_STAFF_SELF_REMOVED";
    recipientUserId: string;
    notificationTitle: string;
    notificationBody: string;
    customerSpaceId: string;
    projectId: string;
    deliveryOverride?: NotificationDeliveryOverride;
  },
) {
  const { delivery, rule, override, excludedUserIds } =
    await resolveProjectStaffPlan(tx, actor, input);
  const persisted = await persistActivityDelivery(tx, delivery, {
    deliveryOverride: override,
  });
  await recordDeliveryOverrideAudit(tx, actor, {
    override,
    ruleKey: "PROJECT_STAFF",
    rule,
    emailPreferenceOverriddenUserIds: persisted.emailPreferenceOverriddenUserIds,
    excludedUserIds,
    customerSpaceId: input.customerSpaceId,
    projectId: input.projectId,
  });
  return persisted;
}

/** 发送前预览：跑一遍真正的收件人计算，但不落库；通道一律按打开算（见上） */
export async function previewProjectStaffRecipients(
  tx: Prisma.TransactionClient,
  actor: Actor,
  input: {
    recipientUserId: string;
    customerSpaceId: string;
    projectId: string;
  },
) {
  const { delivery } = await resolveProjectStaffPlan(tx, actor, {
    change: "PROJECT_STAFF_SELF_ADDED",
    notificationTitle: "",
    notificationBody: "",
    ...input,
    deliveryOverride: { ...PREVIEW_ALL_CHANNELS_ON },
  });
  return {
    ruleKey: "PROJECT_STAFF" as const,
    notificationUserIds: delivery.notifications.map((item) => item.userId),
    emailUserIds: delivery.notifications
      .filter((item) => item.emailEligible)
      .map((item) => item.userId),
  };
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
      // 同上：规则关掉站内就不建通知，也不该响铃
      audible: rule.notificationEnabled && rule.soundEnabled,
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

type RequestActivityRequest = {
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
  deliveryOverride?: NotificationDeliveryOverride;
  /**
   * 本次本来会收到邮件的外部门户联系人（ExternalContact.id）。
   *
   * 他没有 Notification 行，applyDeliveryExclusions 的交集取不到他 —— 只排除他、
   * 别的什么都没改时，审计 effect 会算成「无效覆盖」而整条不记，可邮件确实少发了。
   * 由命令层在确认「本次本来会给他发信」后传入，仅用于把这次排除记进审计。
   */
  externalMailContactId?: string;
};

/**
 * 算出这次服务请求活动的收件人与各通道开关。真正发送与「发送前预览」共用这里，
 * 避免收件人规则出现两份实现而漂移；预览只是把 deliveryOverride 留空来跑。
 */
async function resolveRequestActivityPlan(
  tx: Prisma.TransactionClient,
  actor: Actor,
  input: RequestActivityRequest,
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
  const ruleKey = ruleKeyForRequestActivity({
    notificationType: input.notificationType,
    visibility:
      typeof payload.visibility === "string" ? payload.visibility : undefined,
  });
  const rule = await loadNotificationDeliveryRule(tx, ruleKey);
  const override = sanitizeDeliveryOverride(
    actor,
    input.deliveryOverride,
    ruleChannelSupport(ruleKey),
  );
  const createNotifications =
    input.createNotifications !== false &&
    resolveDeliveryChannel(rule.notificationEnabled, override?.notification);
  // 站内是载体：关掉它，邮件与微信一并失效
  const emailRecipientUserIds =
    project.kind === "STANDARD" &&
    createNotifications &&
    resolveDeliveryChannel(rule.emailEnabled, override?.email)
      ? standardRequestEmailRecipients(
          actor,
          { ...input, relevantWorkerUserIds, emailWorkerUserIds },
          audience,
          includeCustomers,
        )
      : [];
  const planned = planRequestActivity({
    actorId: actor.id,
    audience,
    ...input,
    relevantWorkerUserIds,
    eventPayload: withAudiblePayload(
      input.eventPayload,
      // 同上：本次不建通知（规则关的或本次覆盖关的）就不该还响铃
      createNotifications &&
        resolveNotificationSoundEnabled(rule.soundEnabled, input.audible),
    ),
    includeCustomers,
    createNotifications,
    emailRecipientUserIds,
  });
  const excluded = applyDeliveryExclusions(planned.notifications, override);
  planned.notifications = excluded.notifications;
  return {
    planned,
    ruleKey,
    rule,
    override,
    payload,
    excludedUserIds: [
      ...excluded.excludedUserIds,
      // 外部联系人没有通知行，applyDeliveryExclusions 的交集取不到他；
      // 本次本会给他发信却被排除掉时，这是唯一能让审计记下这件事的地方
      ...(input.externalMailContactId &&
      override?.excludeUserIds?.includes(input.externalMailContactId)
        ? [input.externalMailContactId]
        : []),
    ],
    /**
     * 本次「邮件」这条通道到底开没开（后台规则 + 本次覆盖）。
     * 外部联系人的邮件不挂在 Notification 行上、由命令层单独入队，必须据此判断 ——
     * 否则员工在弹窗里关掉邮件，外部联系人照收，反馈还把它算作已发送。
     */
    emailChannelEnabled:
      createNotifications &&
      resolveDeliveryChannel(rule.emailEnabled, override?.email),
  };
}

export async function dispatchRequestActivity(
  tx: Prisma.TransactionClient,
  actor: Actor,
  input: RequestActivityRequest,
) {
  const {
    planned,
    ruleKey,
    rule,
    override,
    payload,
    excludedUserIds,
    emailChannelEnabled,
  } = await resolveRequestActivityPlan(tx, actor, input);
  const delivery = await persistActivityDelivery(tx, planned, {
    contentRiskReviewId: input.contentRiskReviewId,
    deliveryOverride: override,
  });
  await recordDeliveryOverrideAudit(tx, actor, {
    override,
    ruleKey,
    rule,
    emailPreferenceOverriddenUserIds: delivery.emailPreferenceOverriddenUserIds,
    excludedUserIds,
    customerSpaceId: input.customerSpaceId,
    projectId: input.projectId,
    serviceRequestId: input.serviceRequestId,
  });
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
  // 外部联系人邮件由命令层单独入队，把判断所需的两样带出去。
  // requestedExcludeUserIds 是「清洗后原始的排除名单」，不能用 excludedUserIds ——
  // 后者只保留与真实通知行相交的部分，而外部联系人根本没有 Notification 行，
  // 它的 id 到不了命令层，排除就恒等于没生效。
  return {
    ...delivery,
    emailChannelEnabled,
    excludedUserIds,
    requestedExcludeUserIds: override?.excludeUserIds ?? [],
  };
}


/** 发送前预览：跑一遍真正的收件人计算，但不落库；通道一律按打开算（见上） */
export async function previewRequestActivityRecipients(
  tx: Prisma.TransactionClient,
  actor: Actor,
  input: Omit<
    RequestActivityRequest,
    "deliveryOverride" | "contentRiskReviewId"
  >,
) {
  const { planned, ruleKey } = await resolveRequestActivityPlan(tx, actor, {
    ...input,
    deliveryOverride: { ...PREVIEW_ALL_CHANNELS_ON },
  });
  return {
    ruleKey,
    notificationUserIds: planned.notifications.map((item) => item.userId),
    emailUserIds: planned.notifications
      .filter((item) => item.emailEligible)
      .map((item) => item.userId),
  };
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

function ruleChannelSupport(ruleKey: NotificationDeliveryRuleKey) {
  const definition = NOTIFICATION_DELIVERY_RULES.find(
    (item) => item.key === ruleKey,
  );
  return {
    emailSupported: definition?.emailSupported ?? false,
    wechatSupported: definition?.wechatSupported ?? false,
  };
}

async function persistActivityDelivery(
  tx: Prisma.TransactionClient,
  delivery: ActivityDelivery,
  options?: {
    contentRiskReviewId?: string;
    deliveryOverride?: NotificationDeliveryOverride;
  },
) {
  const events = [];
  const notifications = [];
  const emailPreferenceOverriddenUserIds: string[] = [];
  const emailForced = isEmailForced(options?.deliveryOverride);

  // 被逐人排除的收件人仍要收到实时事件（事件负责页面刷新，不该让他看到过期内容），
  // 但绝不能因此听到提示音 —— 弹窗上明写「本次不提醒他」。事件带上静音名单，
  // 由 GlobalRealtimeSound 对号入座地跳过响铃。
  const silencedUserIds = options?.deliveryOverride?.excludeUserIds ?? [];
  for (const event of delivery.events) {
    events.push(
      await publishEvent(
        tx,
        silencedUserIds.length > 0
          ? {
              ...event,
              payload: {
                ...(event.payload as Prisma.InputJsonObject),
                silencedUserIds,
              },
            }
          : event,
      ),
    );
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
  let perTypeDisabled = new Set<string>();
  let delayEmailUntilUnread = false;
  // 邮件模式是基础设施开关，不是收件人偏好：本地收件箱模式下即使本次强制勾了
  // 邮件也不该入队，否则 deliveryFeedback 会报「已进入发送队列」骗人
  let mailModeAllowsEmail = false;
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
    // 退订偏好是「收件人」的行，但本事务挂在发送方 Actor 的 RLS 会话上：
    // 普通发送方查不到他人偏好（策略仅允许本人/管理员），直接 findMany 会
    // 恒为空 → 已退订用户照发不误。改走 SECURITY DEFINER 函数按收件人集合读取。
    const optouts = await tx.$queryRaw<
      Array<{ user_id: string; rule_key: string }>
    >`
      SELECT user_id, rule_key
      FROM app_notification_email_optouts(${emailCandidateUserIds}::text[])
    `;
    perTypeDisabled = new Set(
      optouts.map((p) => `${p.user_id}:${p.rule_key}`),
    );
    if (settings && settings.mail_mode !== "LOCAL_OUTBOX") {
      mailModeAllowsEmail = true;
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
    // 正在看这一页的人默认不重复打扰。但本次被显式强制发邮件的除外：邮件挂在通知
    // 行上，这里 continue 掉等于强制发送对「恰好在线」的人静默失效 —— 而在线不是
    // 个人偏好，不在强制发送越不过的那几条硬约束里（收件范围 / 绑定额度 / 邮件模式），
    // UI 已经承诺会发。
    const forcedEmailForUser =
      emailForced && notification.emailEligible && mailModeAllowsEmail;
    if (
      !options?.contentRiskReviewId &&
      !forcedEmailForUser &&
      activeUserIds.has(notification.userId)
    ) {
      continue;
    }
    const ruleKey = ruleKeyForNotificationEmail(notification.type);
    const perTypeOptedOut =
      ruleKey != null &&
      perTypeDisabled.has(`${notification.userId}:${ruleKey}`);
    // 本次操作显式勾了邮件 → 无视收件人的全局开关与按场景退订。
    // 这是整条链上唯一凌驾于个人偏好之上的地方，被无视的人要记进审计。
    const preferenceAllowsEmail =
      emailEnabledUserIds.has(notification.userId) && !perTypeOptedOut;
    const emailDueAtForUser =
      mailModeAllowsEmail &&
      (preferenceAllowsEmail || (emailForced && notification.emailEligible))
        ? emailDueAt
        : undefined;
    if (emailDueAtForUser && !preferenceAllowsEmail) {
      emailPreferenceOverriddenUserIds.push(notification.userId);
    }
    const persistenceInput = toNotificationPersistenceInput(
      notification,
      options?.contentRiskReviewId ? undefined : emailDueAtForUser,
    );
    const persistedNotification = await createNotification(
      tx,
      options?.contentRiskReviewId
        ? { ...persistenceInput, aggregationKey: undefined }
        : persistenceInput,
      { wechatOverride: options?.deliveryOverride?.wechat },
    );
    if (options?.contentRiskReviewId) {
      const [held] = await tx.$queryRaw<Array<{ held: boolean }>>`
        SELECT app_hold_notification_for_content_risk(
          ${persistedNotification.id},
          ${options.contentRiskReviewId},
          ${emailDueAtForUser ?? null}
        ) AS held
      `;
      if (!held?.held) throw new Error("风控通知暂缓失败");
    }
    notifications.push(persistedNotification);
    if (emailDueAtForUser) emailCount += 1;
    if (
      emailDueAtForUser &&
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

  return {
    events,
    notifications,
    feedback,
    emailPreferenceOverriddenUserIds,
  };
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
