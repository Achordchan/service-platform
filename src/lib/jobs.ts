import { PgBoss, type JobWithMetadata } from "pg-boss";
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

export const EMAIL_JOB = "send-email";

type MailJobData = {
  mailMessageId: string;
};

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
};

async function startBoss() {
  const boss = new PgBoss(env.JOB_DATABASE_URL);
  await boss.start();
  await boss.createQueue(EMAIL_JOB);
  return boss;
}

export function getBoss() {
  globalForBoss.bossPromise ??= startBoss();
  return globalForBoss.bossPromise;
}

export function isInlineMailWorkerEnabled() {
  return env.MAIL_INLINE_WORKER ?? process.env.NODE_ENV !== "production";
}

export async function enqueueMail(input: EnqueueMailInput) {
  const [settings, template] = await Promise.all([
    getRuntimeMailSettings(),
    buildTemplateMail({
      key: input.templateKey,
      variables: input.variables ?? {},
      actionUrl: input.actionUrl,
    }),
  ]);
  const deliveryMode = input.deliveryMode ?? settings.mailMode;
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
    if (isInlineMailWorkerEnabled()) {
      await startMailWorker();
    }
    const boss = await getBoss();
    const jobId = await boss.send(
      EMAIL_JOB,
      { mailMessageId: message.id },
      {
        retryLimit: deliveryMode === "RESEND" ? 5 : 0,
        retryDelay: 30,
        retryBackoff: true,
      },
    );
    if (!jobId) {
      throw new Error("邮件任务未能加入队列");
    }
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

export async function startMailWorker() {
  if (globalForBoss.bossWorkerStarted) {
    return globalForBoss.bossWorkerPromise;
  }
  globalForBoss.bossWorkerStarted = true;
  globalForBoss.bossWorkerPromise = (async () => {
    const boss = await getBoss();
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
  })().catch((error) => {
    globalForBoss.bossWorkerStarted = false;
    globalForBoss.bossWorkerPromise = undefined;
    throw error;
  });
  return globalForBoss.bossWorkerPromise;
}
