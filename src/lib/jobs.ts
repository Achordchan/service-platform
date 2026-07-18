import { PgBoss, type JobWithMetadata } from "pg-boss";
import pg from "pg";
import type { MailDeliveryMode } from "@/generated/prisma/client";
import { processMailMessage } from "@/lib/mail";
import { env } from "@/lib/runtime-env";
import { withSystemDb } from "@/lib/system-db";
import {
  buildTemplateMail,
} from "@/modules/platform-settings/mail-template-service";
import type { MailTemplateKey } from "@/modules/platform-settings/mail-template-catalog";
import {
  getRuntimeMailSettings,
} from "@/modules/platform-settings/mail-settings-runtime";
import { assertDeliveryModeReady } from "@/modules/platform-settings/mail-delivery-readiness";
import {
  optimizeAttachmentWithWebp,
  processImageWebpMigrationBatch,
  releaseImageWebpMigrationRun,
} from "@/modules/plugins/image-webp-runtime-service";
import { ensurePluginInstallations } from "@/modules/plugins/plugin-installation-service";
import {
  cleanupExpiredUniversalLaunchTickets,
} from "@/modules/integrations/universal/ticket-service";
import {
  listDueUniversalWebhookDeliveries,
  processUniversalWebhookDelivery,
} from "@/modules/integrations/universal/webhook-service";

export const EMAIL_JOB = "send-email";
export const IMAGE_WEBP_JOB = "plugin-image-webp";
export const UNIVERSAL_WEBHOOK_JOB = "universal-webhook-delivery";
export const UNIVERSAL_WEBHOOK_SWEEP_JOB = "universal-webhook-sweep";
export const UNIVERSAL_MAINTENANCE_JOB = "universal-maintenance";

type MailJobData = {
  mailMessageId: string;
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
  return boss;
}

export function getBoss() {
  globalForBoss.bossPromise ??= startBoss();
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
) {
  if (isInlineMailWorkerEnabled()) {
    await startMailWorker();
  }
  const boss = await getBoss();
  const jobId = await boss.send(
    EMAIL_JOB,
    { mailMessageId },
    {
      retryLimit: deliveryMode === "RESEND" ? 5 : 0,
      retryDelay: 30,
      retryBackoff: true,
    },
  );
  if (!jobId) {
    throw new Error("邮件任务未能加入队列");
  }
  return jobId;
}

export async function enqueueMail(input: EnqueueMailInput) {
  const { deliveryMode } = await resolveDeliveryMode(input.deliveryMode);
  const template = await buildTemplateMail({
    key: input.templateKey,
    variables: input.variables ?? {},
    actionUrl: input.actionUrl,
  });
  const message = await withSystemDb((tx) =>
    tx.mailMessage.create({
      data: {
        toEmail: input.to.trim().toLowerCase(),
        templateKey: template.templateKey,
        subject: template.subject,
        previewText: template.previewText,
        heading: template.heading,
        body: template.body,
        actionLabel: template.actionLabel,
        actionUrl: template.actionUrl,
        deliveryMode,
        status: "QUEUED",
      },
    }),
  );

  try {
    const jobId = await queueMailMessage(message.id, deliveryMode);
    return { jobId, mailMessageId: message.id };
  } catch (error) {
    await withSystemDb((tx) =>
      tx.mailMessage.update({
        where: { id: message.id },
        data: {
          status: "FAILED",
          errorMessage:
            error instanceof Error ? error.message : "邮件任务入队失败",
        },
      }),
    );
    throw error;
  }
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
    await boss.work<MailJobData>(
      EMAIL_JOB,
      { includeMetadata: true },
      async (jobs) => {
        for (const job of jobs as JobWithMetadata<MailJobData>[]) {
          await processMailMessage(job.data.mailMessageId, {
            finalAttempt: job.retryCount >= job.retryLimit,
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
    await queueDueUniversalWebhooks();
  })().catch((error) => {
    globalForBoss.bossWorkerStarted = false;
    globalForBoss.bossWorkerPromise = undefined;
    throw error;
  });
  return globalForBoss.bossWorkerPromise;
}
