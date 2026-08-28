import { PgBoss, type JobWithMetadata } from "pg-boss";
import { randomUUID } from "node:crypto";
import pg from "pg";
import type {
  MailDeliveryMode,
  MailMessageStatus,
  Prisma,
} from "@/generated/prisma/client";
import { processMailMessage } from "@/lib/mail";
import {
  buildMailOutboxCandidateWhere,
  MAIL_PROCESSING_CLAIM_STALE_MS,
  mailAttemptBudgetWhere,
  parseMailJobDeliveryMode,
} from "@/lib/mail-outbox-policy";
import { env } from "@/lib/runtime-env";
import { withSystemDb } from "@/lib/system-db";
import {
  buildTemplateMailInTx,
} from "@/modules/platform-settings/mail-template-service";
import type { MailTemplateKey } from "@/modules/platform-settings/mail-template-catalog";
import {
  getRuntimeMailSettings,
} from "@/modules/platform-settings/mail-settings-runtime";
import { assertDeliveryModeReady } from "@/modules/platform-settings/mail-delivery-readiness";
import { resolveLockedMailDeliveryMode } from "@/modules/platform-settings/mail-provider-lifecycle";
import {
  optimizeAttachmentWithWebp,
  processImageWebpMigrationBatch,
  releaseImageWebpMigrationRun,
} from "@/modules/plugins/image-webp-runtime-service";
import { ensurePluginInstallations } from "@/modules/plugins/plugin-installation-service";
import {
  listDueDingTalkRobotDeliveries,
  processDingTalkRobotDelivery,
} from "@/modules/plugins/dingtalk-robot-service";
import {
  listDueContentRiskReviews,
  processContentRiskReview,
} from "@/modules/plugins/content-risk-review-service";
import {
  cleanupExpiredUniversalLaunchTickets,
} from "@/modules/integrations/universal/ticket-service";
import { cleanupExpiredMiniappIdentityData } from "@/modules/miniapp/identity-sweep-service";
import { cleanupExpiredRequestPresence } from "@/modules/requests/presence-sweep-service";
import {
  listDueWechatSubscribeDeliveries,
  processWechatSubscribeMessageDelivery,
} from "@/modules/miniapp/wechat-subscribe-worker";
import { cleanupAbandonedInlineAttachments } from "@/modules/attachments/inline-attachment-service";
import {
  listStalePendingPreviews,
  renderAttachmentPdfPreview,
} from "@/modules/attachments/preview-render-service";
import {
  listDueUniversalWebhookDeliveries,
  processUniversalWebhookDelivery,
} from "@/modules/integrations/universal/webhook-service";
import { createDueNotificationMailMessages } from "@/modules/notifications/notification-email-service";
import { closeResolvedRequestsDue } from "@/modules/requests/request-auto-close-service";
import {
  describeMailQueueFailure,
  formatMailFailureMessage,
  mailFailureReferenceId,
} from "@/modules/platform-settings/mail-delivery-error";

export const EMAIL_JOB = "send-email";
export const IMAGE_WEBP_JOB = "plugin-image-webp";
export const UNIVERSAL_WEBHOOK_JOB = "universal-webhook-delivery";
export const UNIVERSAL_WEBHOOK_SWEEP_JOB = "universal-webhook-sweep";
export const UNIVERSAL_MAINTENANCE_JOB = "universal-maintenance";
export const INLINE_ATTACHMENT_MAINTENANCE_JOB =
  "inline-attachment-maintenance";
export const MAIL_OUTBOX_SWEEP_JOB = "mail-outbox-sweep";
export const DINGTALK_ROBOT_JOB = "plugin-dingtalk-robot-delivery";
export const DINGTALK_ROBOT_SWEEP_JOB = "plugin-dingtalk-robot-sweep";
export const REQUEST_AUTO_CLOSE_SWEEP_JOB = "request-auto-close-sweep";
export const CONTENT_RISK_REVIEW_JOB = "plugin-content-risk-review";
export const CONTENT_RISK_SWEEP_JOB = "plugin-content-risk-sweep";
export const MINIAPP_IDENTITY_SWEEP_JOB = "miniapp-identity-sweep";
export const WECHAT_SUBSCRIBE_MESSAGE_JOB = "wechat-subscribe-message";
export const WECHAT_SUBSCRIBE_SWEEP_JOB = "wechat-subscribe-sweep";
export const ATTACHMENT_PREVIEW_JOB = "attachment-preview-render";
export const ATTACHMENT_PREVIEW_SWEEP_JOB = "attachment-preview-sweep";
export const REQUEST_PRESENCE_SWEEP_JOB = "request-presence-sweep";

type MailJobData = {
  mailMessageId: string;
  deliveryMode?: MailDeliveryMode;
};

type ImageWebpJobData =
  | {
      kind: "ATTACHMENT";
      attachmentId: string;
    }
  | {
      kind: "MIGRATION";
      runId: string;
      executionToken: string;
    };

type UniversalWebhookJobData = { deliveryId: string };
type DingTalkRobotJobData = { deliveryId: string };
type ContentRiskReviewJobData = { reviewId: string };

export type EnqueueMailInput = {
  to: string;
  templateKey: MailTemplateKey;
  variables?: Record<string, string>;
  actionUrl?: string;
  deliveryMode?: MailDeliveryMode;
  sendAfter?: Date;
  idempotencyKey?: string;
  notificationId?: string;
  notificationOccurrenceCount?: number;
  sourceType?: string;
  sourceId?: string;
  contentRiskReviewId?: string;
};

const globalForBoss = globalThis as unknown as {
  bossPromise?: Promise<PgBoss>;
  bossWorkerStarted?: boolean;
  bossWorkerPromise?: Promise<void>;
  databaseListenerPromise?: Promise<void>;
  databaseListenerClient?: pg.Client;
  databaseListenerReconnectTimer?: ReturnType<typeof setTimeout>;
  mailOutboxWakePromise?: Promise<void>;
  mailOutboxWakePending?: boolean;
};

const DATABASE_LISTENER_RECONNECT_MS = 5_000;

async function startBoss() {
  const boss = new PgBoss(env.JOB_DATABASE_URL);
  await boss.start();
  await boss.createQueue(EMAIL_JOB);
  await boss.createQueue(IMAGE_WEBP_JOB);
  await boss.createQueue(UNIVERSAL_WEBHOOK_JOB);
  await boss.createQueue(UNIVERSAL_WEBHOOK_SWEEP_JOB);
  await boss.createQueue(UNIVERSAL_MAINTENANCE_JOB);
  await boss.createQueue(INLINE_ATTACHMENT_MAINTENANCE_JOB);
  await boss.createQueue(MAIL_OUTBOX_SWEEP_JOB);
  await boss.createQueue(DINGTALK_ROBOT_JOB);
  await boss.createQueue(DINGTALK_ROBOT_SWEEP_JOB);
  await boss.createQueue(REQUEST_AUTO_CLOSE_SWEEP_JOB);
  await boss.createQueue(CONTENT_RISK_REVIEW_JOB);
  await boss.createQueue(MINIAPP_IDENTITY_SWEEP_JOB);
  await boss.createQueue(WECHAT_SUBSCRIBE_MESSAGE_JOB);
  await boss.createQueue(WECHAT_SUBSCRIBE_SWEEP_JOB);
  await boss.createQueue(CONTENT_RISK_SWEEP_JOB);
  await boss.createQueue(ATTACHMENT_PREVIEW_JOB);
  await boss.createQueue(ATTACHMENT_PREVIEW_SWEEP_JOB);
  await boss.createQueue(REQUEST_PRESENCE_SWEEP_JOB);
  return boss;
}

export function getBoss() {
  if (!globalForBoss.bossPromise) {
    const bossPromise = startBoss();
    globalForBoss.bossPromise = bossPromise;
    void bossPromise.catch(() => {
      if (globalForBoss.bossPromise === bossPromise) {
        globalForBoss.bossPromise = undefined;
      }
    });
  }
  return globalForBoss.bossPromise;
}

export function isInlineMailWorkerEnabled() {
  return env.MAIL_INLINE_WORKER ?? process.env.NODE_ENV !== "production";
}

async function resolveDeliveryMode(requested?: MailDeliveryMode) {
  const settings = await getRuntimeMailSettings();
  const deliveryMode = requested ?? settings.mailMode;
  assertDeliveryModeReady(settings, deliveryMode);
  return { settings, deliveryMode };
}

export async function assertMailDeliveryReady(
  deliveryMode?: MailDeliveryMode,
) {
  return (await resolveDeliveryMode(deliveryMode)).deliveryMode;
}

export async function queueMailMessage(
  mailMessageId: string,
  deliveryMode: MailDeliveryMode,
  startAfter?: Date,
) {
  if (isInlineMailWorkerEnabled() && !globalForBoss.bossWorkerStarted) {
    await startMailWorker();
  }
  const boss = await getBoss();
  const deferredUntil =
    startAfter && startAfter.getTime() > Date.now() ? startAfter : undefined;
  const result = await boss.upsert(
    EMAIL_JOB,
    { mailMessageId, deliveryMode },
    {
      singletonKey: mailMessageId,
      match: "all",
      retryLimit: deliveryMode === "RESEND" ? 5 : 0,
      retryDelay: 30,
      retryBackoff: true,
      startAfter: deferredUntil,
    },
  );
  const jobId = result.jobs[0];
  if (!jobId) {
    throw new Error("邮件任务未能加入队列");
  }
  return jobId;
}

export async function enqueueMail(input: EnqueueMailInput) {
  const message = await withSystemDb(async (tx) => {
    if (!input.contentRiskReviewId) {
      return createMailMessageInTx(tx, input);
    }
    const disposition = await resolveContentRiskMailDisposition(
      tx,
      input.contentRiskReviewId,
    );
    if (!disposition.create) return null;
    return createMailMessageInTx(
      tx,
      {
        ...input,
        contentRiskReviewId: disposition.keepReviewId
          ? input.contentRiskReviewId
          : undefined,
      },
      disposition.status,
    );
  });
  if (!message) return { jobId: null, mailMessageId: null };
  if (message.status !== "QUEUED" || message.contentRiskReviewId) {
    return { jobId: null, mailMessageId: message.id };
  }
  const jobId = await dispatchQueuedMailMessage(
    message.id,
    message.deliveryMode,
    message.sendAfter,
  );
  return { jobId, mailMessageId: message.id };
}

export async function createMailMessageInTx(
  tx: Prisma.TransactionClient,
  input: EnqueueMailInput,
  initialStatus: Extract<MailMessageStatus, "QUEUED" | "CANCELLED"> = "QUEUED",
) {
  const template = await buildTemplateMailInTx(tx, {
    key: input.templateKey,
    variables: input.variables ?? {},
    actionUrl: input.actionUrl,
  });
  return createPreparedMailMessageInTx(tx, input, template, initialStatus);
}

export function prepareMailMessageTemplate(input: EnqueueMailInput) {
  return withSystemDb((tx) =>
    buildTemplateMailInTx(tx, {
      key: input.templateKey,
      variables: input.variables ?? {},
      actionUrl: input.actionUrl,
    }),
  );
}

export async function createPreparedMailMessageInTx(
  tx: Prisma.TransactionClient,
  input: EnqueueMailInput,
  template: Awaited<ReturnType<typeof prepareMailMessageTemplate>>,
  initialStatus: Extract<MailMessageStatus, "QUEUED" | "CANCELLED"> = "QUEUED",
) {
  const deliveryMode = await resolveLockedMailDeliveryMode(
    tx,
    input.deliveryMode,
  );
  const id = randomUUID();
  const toEmail = input.to.trim().toLowerCase();
  const sendAfter = input.sendAfter ?? new Date();
  const createdAt = new Date();
  await tx.$executeRaw`
    INSERT INTO "MailMessage" (
      id,
      "toEmail",
      "templateKey",
      subject,
      "previewText",
      heading,
      body,
      "actionLabel",
      "actionUrl",
      "sendAfter",
      "idempotencyKey",
      "notificationId",
      "notificationOccurrenceCount",
      "sourceType",
      "sourceId",
      "contentRiskReviewId",
      "deliveryMode",
      status,
      "createdAt",
      "updatedAt"
    )
    VALUES (
      ${id},
      ${toEmail},
      ${template.templateKey},
      ${template.subject},
      ${template.previewText},
      ${template.heading},
      ${template.body},
      ${template.actionLabel},
      ${template.actionUrl},
      ${sendAfter},
      ${input.idempotencyKey ?? null},
      ${input.notificationId ?? null},
      ${input.notificationOccurrenceCount ?? null},
      ${input.sourceType ?? null},
      ${input.sourceId ?? null},
      ${input.contentRiskReviewId ?? null},
      ${deliveryMode}::"MailDeliveryMode",
      ${initialStatus}::"MailMessageStatus",
      ${createdAt},
      ${createdAt}
    )
  `;
  return {
    id,
    toEmail,
    templateKey: template.templateKey,
    subject: template.subject,
    previewText: template.previewText,
    heading: template.heading,
    body: template.body,
    actionLabel: template.actionLabel,
    actionUrl: template.actionUrl,
    sendAfter,
    idempotencyKey: input.idempotencyKey ?? null,
    notificationId: input.notificationId ?? null,
    notificationOccurrenceCount:
      input.notificationOccurrenceCount ?? null,
    sourceType: input.sourceType ?? null,
    sourceId: input.sourceId ?? null,
    contentRiskReviewId: input.contentRiskReviewId ?? null,
    deliveryMode,
    status: initialStatus,
  };
}

async function resolveContentRiskMailDisposition(
  tx: Prisma.TransactionClient,
  reviewId: string,
) {
  const target = await tx.contentRiskReview.findUnique({
    where: { id: reviewId },
    select: { targetType: true, targetId: true },
  });
  if (!target) return { create: false as const };
  await tx.$executeRaw`
    SELECT pg_advisory_xact_lock(
      hashtext(${`${target.targetType}:${target.targetId}`})
    )
  `;
  const [review, state, runtime] = await Promise.all([
    tx.contentRiskReview.findUnique({ where: { id: reviewId } }),
    tx.contentRiskState.findUnique({
      where: {
        targetType_targetId: {
          targetType: target.targetType,
          targetId: target.targetId,
        },
      },
      select: { latestReviewId: true, revision: true },
    }),
    tx.contentRiskRuntimeState.findUnique({
      where: { pluginKey: "content-contact-risk" },
      select: { bypassedAt: true },
    }),
  ]);
  if (
    !review ||
    state?.latestReviewId !== review.id ||
    state.revision !== review.revision
  ) {
    return { create: false as const };
  }
  if (review.status === "QUEUED" || review.status === "PROCESSING") {
    return {
      create: true as const,
      status: "QUEUED" as const,
      keepReviewId: true,
    };
  }
  if (review.status === "VIOLATION") {
    return {
      create: true as const,
      status: "CANCELLED" as const,
      keepReviewId: true,
    };
  }
  if (
    review.status === "PASSED" ||
    review.status === "UNCERTAIN" ||
    review.status === "SKIPPED_UNSUPPORTED" ||
    (review.status === "CANCELLED" && Boolean(runtime?.bypassedAt))
  ) {
    return {
      create: true as const,
      status: "QUEUED" as const,
      keepReviewId: false,
    };
  }
  return { create: false as const };
}

export async function dispatchQueuedMailMessage(
  mailMessageId: string,
  deliveryMode: MailDeliveryMode,
  sendAfter?: Date,
) {
  try {
    return await queueMailMessage(mailMessageId, deliveryMode, sendAfter);
  } catch (error) {
    await recordMailQueueFailure(mailMessageId, error, "initial_enqueue");
    return null;
  }
}

export async function recordMailQueueFailure(
  mailMessageId: string,
  error: unknown,
  phase: "initial_enqueue" | "outbox_sweep" | "manual_retry",
) {
  const failure = describeMailQueueFailure(error);
  const referenceId = mailFailureReferenceId(mailMessageId);
  console.error(
    "ACHORD_MAIL_QUEUE_FAILED",
    JSON.stringify({
      event: "mail.queue_failed",
      referenceId,
      mailMessageId,
      phase,
      error: failure,
    }),
  );
  await withSystemDb((tx) =>
    tx.mailMessage.updateMany({
      where: { id: mailMessageId, status: "QUEUED" },
      data: {
        errorMessage: formatMailFailureMessage(failure.message, referenceId),
      },
    }),
  );
  return { ...failure, referenceId };
}

async function queuePendingMailMessages() {
  const now = new Date();
  await withSystemDb((tx) =>
    tx.mailMessage.updateMany({
      where: {
        status: "QUEUED",
        NOT: mailAttemptBudgetWhere(),
      },
      data: {
        status: "FAILED",
        errorMessage: "邮件发送已达到重试上限",
      },
    }),
  );
  await withSystemDb((tx) =>
    tx.mailMessage.updateMany({
      where: {
        status: "PROCESSING",
        deliveryMode: { in: ["RESEND", "LOCAL_OUTBOX"] },
        lastAttemptAt: {
          lt: new Date(now.getTime() - MAIL_PROCESSING_CLAIM_STALE_MS),
        },
        NOT: mailAttemptBudgetWhere(),
      },
      data: {
        status: "FAILED",
        errorMessage: "邮件发送已达到重试上限",
      },
    }),
  );
  await withSystemDb((tx) =>
    tx.mailMessage.updateMany({
      where: {
        status: "PROCESSING",
        deliveryMode: "SMTP",
        lastAttemptAt: {
          lt: new Date(now.getTime() - MAIL_PROCESSING_CLAIM_STALE_MS),
        },
      },
      data: {
        status: "FAILED",
        errorMessage:
          "SMTP 发送结果不确定，系统未自动重试；请核对收件箱后再决定是否手动重发",
      },
    }),
  );
  const messages = await withSystemDb((tx) =>
    tx.mailMessage.findMany({
      where: buildMailOutboxCandidateWhere(now),
      select: { id: true, deliveryMode: true, sendAfter: true },
      orderBy: [{ lastAttemptAt: "asc" }, { sendAfter: "asc" }],
      take: 100,
    }),
  );
  for (const message of messages) {
    try {
      await queueMailMessage(
        message.id,
        message.deliveryMode,
        message.sendAfter,
      );
    } catch (error) {
      await recordMailQueueFailure(message.id, error, "outbox_sweep");
    }
  }
}

async function processMailOutbox() {
  await createDueNotificationMailMessages();
  await queuePendingMailMessages();
}

async function wakeMailOutbox() {
  globalForBoss.mailOutboxWakePending = true;
  if (globalForBoss.mailOutboxWakePromise) {
    return globalForBoss.mailOutboxWakePromise;
  }
  const wakePromise = (async () => {
    while (globalForBoss.mailOutboxWakePending) {
      globalForBoss.mailOutboxWakePending = false;
      await processMailOutbox();
    }
  })().finally(() => {
    if (globalForBoss.mailOutboxWakePromise === wakePromise) {
      globalForBoss.mailOutboxWakePromise = undefined;
    }
  });
  globalForBoss.mailOutboxWakePromise = wakePromise;
  return wakePromise;
}

export async function queueImageWebpAttachment(attachmentId: string) {
  if (isInlineMailWorkerEnabled()) {
    await startMailWorker();
  }
  const boss = await getBoss();
  const jobId = await boss.send(
    IMAGE_WEBP_JOB,
    { kind: "ATTACHMENT", attachmentId },
    {
      retryLimit: 2,
      retryDelay: 30,
      retryBackoff: true,
      singletonKey: attachmentId,
      singletonSeconds: 60,
      group: { id: IMAGE_WEBP_JOB },
    },
  );
  if (!jobId) {
    throw new Error("图片优化任务未能加入队列");
  }
  return jobId;
}

export async function queueImageWebpMigrationRun(
  runId: string,
  executionToken: string,
) {
  if (isInlineMailWorkerEnabled()) {
    await startMailWorker();
  }
  const boss = await getBoss();
  const jobId = await boss.send(
    IMAGE_WEBP_JOB,
    { kind: "MIGRATION", runId, executionToken },
    {
      retryLimit: 2,
      retryDelay: 30,
      retryBackoff: true,
      group: { id: IMAGE_WEBP_JOB },
    },
  );
  if (!jobId) {
    throw new Error("历史图片迁移任务未能加入队列");
  }
  return jobId;
}

export async function queueAttachmentPreviewRender(attachmentId: string) {
  if (isInlineMailWorkerEnabled()) {
    await startMailWorker();
  }
  const boss = await getBoss();
  const jobId = await boss.send(
    ATTACHMENT_PREVIEW_JOB,
    { attachmentId },
    {
      retryLimit: 2,
      retryDelay: 60,
      retryBackoff: true,
      singletonKey: attachmentId,
      singletonSeconds: 60,
    },
  );
  if (!jobId) {
    throw new Error("附件预览件任务未能加入队列");
  }
  return jobId;
}

export async function queueUniversalWebhookDelivery(
  deliveryId: string,
  startAfter?: Date,
) {
  const boss = await getBoss();
  const jobId = await boss.send(
    UNIVERSAL_WEBHOOK_JOB,
    { deliveryId },
    {
      retryLimit: 0,
      startAfter,
      singletonKey: deliveryId,
      singletonSeconds: 30,
    },
  );
  if (!jobId) return null;
  return jobId;
}

async function queueDueUniversalWebhooks() {
  const deliveries = await listDueUniversalWebhookDeliveries();
  for (const delivery of deliveries) {
    await queueUniversalWebhookDelivery(delivery.id);
  }
}

export async function queueWechatSubscribeMessageDelivery(
  deliveryId: string,
) {
  const boss = await getBoss();
  await boss.send(
    WECHAT_SUBSCRIBE_MESSAGE_JOB,
    { deliveryId },
    {
      retryLimit: 4,
      retryDelay: 60,
      retryBackoff: true,
      singletonKey: deliveryId,
      singletonSeconds: 30,
    },
  );
}

async function queueDueWechatSubscribeDeliveries() {
  const deliveries = await listDueWechatSubscribeDeliveries();
  for (const delivery of deliveries) {
    await queueWechatSubscribeMessageDelivery(delivery.id);
  }
}

export async function queueDingTalkRobotDelivery(
  deliveryId: string,
  startAfter?: Date | null,
) {
  const boss = await getBoss();
  return boss.send(
    DINGTALK_ROBOT_JOB,
    { deliveryId },
    {
      retryLimit: 4,
      retryDelay: 60,
      retryBackoff: true,
      ...(startAfter ? { startAfter } : {}),
      singletonKey: deliveryId,
      singletonSeconds: 30,
    },
  );
}

async function queueDueDingTalkRobotDeliveries() {
  const deliveries = await listDueDingTalkRobotDeliveries();
  for (const delivery of deliveries) {
    await queueDingTalkRobotDelivery(delivery.id, delivery.nextAttemptAt);
  }
}

export async function queueContentRiskReview(reviewId: string) {
  const boss = await getBoss();
  return boss.send(
    CONTENT_RISK_REVIEW_JOB,
    { reviewId },
    {
      retryLimit: 0,
      singletonKey: reviewId,
      singletonSeconds: 30,
    },
  );
}

async function queueDueContentRiskReviews() {
  const reviews = await listDueContentRiskReviews();
  for (const review of reviews) {
    await queueContentRiskReview(review.id);
  }
}

function scheduleDatabaseListenerReconnect() {
  if (
    globalForBoss.databaseListenerReconnectTimer ||
    !globalForBoss.bossWorkerStarted
  ) {
    return;
  }
  const timer = setTimeout(() => {
    globalForBoss.databaseListenerReconnectTimer = undefined;
    void startDatabaseListener().catch(() => {
      scheduleDatabaseListenerReconnect();
    });
  }, DATABASE_LISTENER_RECONNECT_MS);
  timer.unref();
  globalForBoss.databaseListenerReconnectTimer = timer;
}

async function startDatabaseListener() {
  if (globalForBoss.databaseListenerPromise) {
    return globalForBoss.databaseListenerPromise;
  }
  const listenerPromise = (async () => {
    const client = new pg.Client({ connectionString: env.DATABASE_URL });
    try {
      await client.connect();
      await client.query("LISTEN service_platform_webhook_deliveries");
      await client.query("LISTEN service_platform_mail_outbox");
      await client.query("LISTEN service_platform_dingtalk_deliveries");
      await client.query("LISTEN service_platform_content_risk");
      await client.query("LISTEN service_platform_wechat_deliveries");
    } catch (error) {
      await client.end().catch(() => undefined);
      throw error;
    }
    globalForBoss.databaseListenerClient = client;
    client.on("notification", (message) => {
      if (message.channel === "service_platform_webhook_deliveries") {
        const deliveryId = message.payload?.trim();
        if (!deliveryId) return;
        void queueUniversalWebhookDelivery(deliveryId).catch(() => undefined);
        return;
      }
      if (message.channel === "service_platform_mail_outbox") {
        void wakeMailOutbox().catch((error) => {
          console.error(
            "ACHORD_MAIL_OUTBOX_WAKE_FAILED",
            error instanceof Error ? error.message : String(error),
          );
        });
        return;
      }
      if (message.channel === "service_platform_dingtalk_deliveries") {
        const deliveryId = message.payload?.trim();
        if (!deliveryId) return;
        void queueDingTalkRobotDelivery(deliveryId).catch(() => undefined);
        return;
      }
      if (message.channel === "service_platform_content_risk") {
        const reviewId = message.payload?.trim();
        if (!reviewId) return;
        void queueContentRiskReview(reviewId).catch(() => undefined);
        return;
      }
      if (message.channel === "service_platform_wechat_deliveries") {
        const deliveryId = message.payload?.trim();
        if (!deliveryId) return;
        void queueWechatSubscribeMessageDelivery(deliveryId).catch(
          () => undefined,
        );
      }
    });
    const handleDisconnect = () => {
      if (globalForBoss.databaseListenerClient !== client) return;
      globalForBoss.databaseListenerClient = undefined;
      globalForBoss.databaseListenerPromise = undefined;
      scheduleDatabaseListenerReconnect();
    };
    client.on("error", handleDisconnect);
    client.on("end", handleDisconnect);
  })();
  globalForBoss.databaseListenerPromise = listenerPromise;
  try {
    await listenerPromise;
  } catch (error) {
    if (globalForBoss.databaseListenerPromise === listenerPromise) {
      globalForBoss.databaseListenerPromise = undefined;
    }
    scheduleDatabaseListenerReconnect();
    throw error;
  }
}

export async function startMailWorker() {
  if (globalForBoss.bossWorkerStarted) {
    return globalForBoss.bossWorkerPromise;
  }
  globalForBoss.bossWorkerStarted = true;
  globalForBoss.bossWorkerPromise = (async () => {
    await ensurePluginInstallations();
    const boss = await getBoss();
    await startDatabaseListener().catch(() => undefined);
    await boss.schedule(UNIVERSAL_WEBHOOK_SWEEP_JOB, "* * * * *");
    await boss.schedule(UNIVERSAL_MAINTENANCE_JOB, "17 3 * * *");
    await boss.schedule(INLINE_ATTACHMENT_MAINTENANCE_JOB, "43 3 * * *");
    await boss.schedule(MAIL_OUTBOX_SWEEP_JOB, "* * * * *");
    await boss.schedule(DINGTALK_ROBOT_SWEEP_JOB, "* * * * *");
    await boss.schedule(REQUEST_AUTO_CLOSE_SWEEP_JOB, "7 * * * *");
    await boss.schedule(CONTENT_RISK_SWEEP_JOB, "* * * * *");
    await boss.schedule(MINIAPP_IDENTITY_SWEEP_JOB, "23 4 * * *");
    await boss.schedule(WECHAT_SUBSCRIBE_SWEEP_JOB, "* * * * *");
    await boss.schedule(ATTACHMENT_PREVIEW_SWEEP_JOB, "*/10 * * * *");
    // 在线记录的保留期清理：错开整点，避开其它每日任务
    await boss.schedule(REQUEST_PRESENCE_SWEEP_JOB, "41 3 * * *");
    await boss.work<MailJobData>(
      EMAIL_JOB,
      { includeMetadata: true },
      async (jobs) => {
        for (const job of jobs as JobWithMetadata<MailJobData>[]) {
          const deliveryMode = parseMailJobDeliveryMode(job.data.deliveryMode);
          if (!deliveryMode) {
            continue;
          }
          await processMailMessage(job.data.mailMessageId, {
            finalAttempt: job.retryCount >= job.retryLimit,
            expectedDeliveryMode: deliveryMode,
          });
        }
      },
    );
    await boss.work<ImageWebpJobData>(
      IMAGE_WEBP_JOB,
      {
        batchSize: 1,
        localConcurrency: 1,
        groupConcurrency: 1,
      },
      async (jobs) => {
        for (const job of jobs) {
          if (job.data.kind === "ATTACHMENT") {
            await optimizeAttachmentWithWebp(job.data.attachmentId, {
              source: "UPLOAD",
            });
          } else {
            try {
              const shouldContinue = await processImageWebpMigrationBatch(
                job.data.runId,
                job.data.executionToken,
              );
              if (shouldContinue) {
                await queueImageWebpMigrationRun(
                  job.data.runId,
                  job.data.executionToken,
                );
              }
            } catch (error) {
              await releaseImageWebpMigrationRun(
                job.data.runId,
                job.data.executionToken,
                error,
              );
              throw error;
            }
          }
        }
      },
    );
    await boss.work<UniversalWebhookJobData>(
      UNIVERSAL_WEBHOOK_JOB,
      { batchSize: 1, localConcurrency: 2 },
      async (jobs) => {
        for (const job of jobs) {
          const result = await processUniversalWebhookDelivery(
            job.data.deliveryId,
          );
          if (result.queued && result.nextAttemptAt) {
            await queueUniversalWebhookDelivery(
              job.data.deliveryId,
              result.nextAttemptAt,
            );
          }
        }
      },
    );
    await boss.work<DingTalkRobotJobData>(
      DINGTALK_ROBOT_JOB,
      { batchSize: 1, localConcurrency: 1, includeMetadata: true },
      async (jobs) => {
        for (const job of jobs as JobWithMetadata<DingTalkRobotJobData>[]) {
          await processDingTalkRobotDelivery(job.data.deliveryId, {
            finalAttempt: job.retryCount >= job.retryLimit,
          });
        }
      },
    );
    await boss.work<ContentRiskReviewJobData>(
      CONTENT_RISK_REVIEW_JOB,
      { batchSize: 1, localConcurrency: 2 },
      async (jobs) => {
        for (const job of jobs) {
          await processContentRiskReview(job.data.reviewId);
        }
      },
    );
    await boss.work(
      UNIVERSAL_WEBHOOK_SWEEP_JOB,
      { batchSize: 1, localConcurrency: 1 },
      async () => {
        await queueDueUniversalWebhooks();
      },
    );
    await boss.work(
      UNIVERSAL_MAINTENANCE_JOB,
      { batchSize: 1, localConcurrency: 1 },
      async () => {
        await cleanupExpiredUniversalLaunchTickets();
      },
    );
    await boss.work(
      MINIAPP_IDENTITY_SWEEP_JOB,
      { batchSize: 1, localConcurrency: 1 },
      async () => {
        await cleanupExpiredMiniappIdentityData();
      },
    );
    await boss.work(
      REQUEST_PRESENCE_SWEEP_JOB,
      { batchSize: 1, localConcurrency: 1 },
      async () => {
        await cleanupExpiredRequestPresence();
      },
    );
    await boss.work(WECHAT_SUBSCRIBE_SWEEP_JOB, { batchSize: 1, localConcurrency: 1 }, async () => {
      await queueDueWechatSubscribeDeliveries();
    });
    await boss.work(
      WECHAT_SUBSCRIBE_MESSAGE_JOB,
      { batchSize: 1, localConcurrency: 1, includeMetadata: true },
      async (jobs) => {
        for (const job of jobs as Array<{ data: { deliveryId: string }; retryCount?: number; retryLimit?: number }>) {
          await processWechatSubscribeMessageDelivery(job.data.deliveryId, {
            finalAttempt:
              (job.retryCount ?? 0) >= (job.retryLimit ?? 0) && (job.retryLimit ?? 0) > 0,
          });
        }
      },
    );
    await boss.work(
      MAIL_OUTBOX_SWEEP_JOB,
      { batchSize: 1, localConcurrency: 1 },
      async () => {
        await wakeMailOutbox();
      },
    );
    await boss.work(
      DINGTALK_ROBOT_SWEEP_JOB,
      { batchSize: 1, localConcurrency: 1 },
      async () => {
        await queueDueDingTalkRobotDeliveries();
      },
    );
    await boss.work(
      INLINE_ATTACHMENT_MAINTENANCE_JOB,
      { batchSize: 1, localConcurrency: 1 },
      async () => {
        await cleanupAbandonedInlineAttachments();
      },
    );
    await boss.work(
      REQUEST_AUTO_CLOSE_SWEEP_JOB,
      { batchSize: 1, localConcurrency: 1 },
      async () => {
        await closeResolvedRequestsDue();
      },
    );
    await boss.work(
      CONTENT_RISK_SWEEP_JOB,
      { batchSize: 1, localConcurrency: 1 },
      async () => {
        await queueDueContentRiskReviews();
      },
    );
    // LibreOffice 转换吃内存，串行处理（VPS 单机）
    await boss.work<{ attachmentId: string }>(
      ATTACHMENT_PREVIEW_JOB,
      { batchSize: 1, localConcurrency: 1 },
      async (jobs) => {
        for (const job of jobs) {
          await renderAttachmentPdfPreview(job.data.attachmentId);
        }
      },
    );
    // 入队失败/任务库故障的兜底：重捞长期 PENDING 的附件
    await boss.work(
      ATTACHMENT_PREVIEW_SWEEP_JOB,
      { batchSize: 1, localConcurrency: 1 },
      async () => {
        const stale = await listStalePendingPreviews();
        for (const attachment of stale) {
          await queueAttachmentPreviewRender(attachment.id);
        }
      },
    );
    await queueDueUniversalWebhooks();
    await queueDueDingTalkRobotDeliveries();
    await queueDueContentRiskReviews();
    await wakeMailOutbox();
    await closeResolvedRequestsDue().catch((error) => {
      console.error(
        "ACHORD_REQUEST_AUTO_CLOSE_STARTUP_FAILED",
        error instanceof Error ? error.message : String(error),
      );
    });
  })().catch((error) => {
    globalForBoss.bossWorkerStarted = false;
    globalForBoss.bossWorkerPromise = undefined;
    throw error;
  });
  return globalForBoss.bossWorkerPromise;
}
