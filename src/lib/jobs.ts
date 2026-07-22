import { PgBoss, type JobWithMetadata } from "pg-boss";
import { randomUUID } from "node:crypto";
import pg from "pg";
import type { MailDeliveryMode, Prisma } from "@/generated/prisma/client";
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
  cleanupExpiredUniversalLaunchTickets,
} from "@/modules/integrations/universal/ticket-service";
import { cleanupAbandonedInlineAttachments } from "@/modules/attachments/inline-attachment-service";
import {
  listDueUniversalWebhookDeliveries,
  processUniversalWebhookDelivery,
} from "@/modules/integrations/universal/webhook-service";
import { createDueNotificationMailMessages } from "@/modules/notifications/notification-email-service";
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
};

const globalForBoss = globalThis as unknown as {
  bossPromise?: Promise<PgBoss>;
  bossWorkerStarted?: boolean;
  bossWorkerPromise?: Promise<void>;
  webhookListenerPromise?: Promise<void>;
  webhookListenerClient?: pg.Client;
  webhookListenerReconnectTimer?: ReturnType<typeof setTimeout>;
};

const WEBHOOK_LISTENER_RECONNECT_MS = 5_000;

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
  const message = await withSystemDb((tx) =>
    createMailMessageInTx(tx, input),
  );
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
) {
  const template = await buildTemplateMailInTx(tx, {
    key: input.templateKey,
    variables: input.variables ?? {},
    actionUrl: input.actionUrl,
  });
  return createPreparedMailMessageInTx(tx, input, template);
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
) {
  const deliveryMode = await resolveLockedMailDeliveryMode(
    tx,
    input.deliveryMode,
  );
  const id = randomUUID();
  const toEmail = input.to.trim().toLowerCase();
  const sendAfter = input.sendAfter ?? new Date();
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
      ${deliveryMode}::"MailDeliveryMode",
      'QUEUED',
      CURRENT_TIMESTAMP,
      CURRENT_TIMESTAMP
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
    deliveryMode,
    status: "QUEUED" as const,
  };
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

function scheduleUniversalWebhookListenerReconnect() {
  if (
    globalForBoss.webhookListenerReconnectTimer ||
    !globalForBoss.bossWorkerStarted
  ) {
    return;
  }
  const timer = setTimeout(() => {
    globalForBoss.webhookListenerReconnectTimer = undefined;
    void startUniversalWebhookListener().catch(() => {
      scheduleUniversalWebhookListenerReconnect();
    });
  }, WEBHOOK_LISTENER_RECONNECT_MS);
  timer.unref();
  globalForBoss.webhookListenerReconnectTimer = timer;
}

async function startUniversalWebhookListener() {
  if (globalForBoss.webhookListenerPromise) {
    return globalForBoss.webhookListenerPromise;
  }
  const listenerPromise = (async () => {
    const client = new pg.Client({ connectionString: env.DATABASE_URL });
    await client.connect();
    await client.query("LISTEN service_platform_webhook_deliveries");
    globalForBoss.webhookListenerClient = client;
    client.on("notification", (message) => {
      const deliveryId = message.payload?.trim();
      if (!deliveryId) return;
      void queueUniversalWebhookDelivery(deliveryId).catch(() => undefined);
    });
    const handleDisconnect = () => {
      if (globalForBoss.webhookListenerClient !== client) return;
      globalForBoss.webhookListenerClient = undefined;
      globalForBoss.webhookListenerPromise = undefined;
      scheduleUniversalWebhookListenerReconnect();
    };
    client.on("error", handleDisconnect);
    client.on("end", handleDisconnect);
  })();
  globalForBoss.webhookListenerPromise = listenerPromise;
  try {
    await listenerPromise;
  } catch (error) {
    if (globalForBoss.webhookListenerPromise === listenerPromise) {
      globalForBoss.webhookListenerPromise = undefined;
    }
    scheduleUniversalWebhookListenerReconnect();
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
    await startUniversalWebhookListener().catch(() => undefined);
    await boss.schedule(UNIVERSAL_WEBHOOK_SWEEP_JOB, "* * * * *");
    await boss.schedule(UNIVERSAL_MAINTENANCE_JOB, "17 3 * * *");
    await boss.schedule(INLINE_ATTACHMENT_MAINTENANCE_JOB, "43 3 * * *");
    await boss.schedule(MAIL_OUTBOX_SWEEP_JOB, "* * * * *");
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
      MAIL_OUTBOX_SWEEP_JOB,
      { batchSize: 1, localConcurrency: 1 },
      async () => {
        await processMailOutbox();
      },
    );
    await boss.work(
      INLINE_ATTACHMENT_MAINTENANCE_JOB,
      { batchSize: 1, localConcurrency: 1 },
      async () => {
        await cleanupAbandonedInlineAttachments();
      },
    );
    await queueDueUniversalWebhooks();
    await processMailOutbox();
  })().catch((error) => {
    globalForBoss.bossWorkerStarted = false;
    globalForBoss.bossWorkerPromise = undefined;
    throw error;
  });
  return globalForBoss.bossWorkerPromise;
}
