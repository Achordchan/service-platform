import { PgBoss } from "pg-boss";
import { env } from "@/lib/runtime-env";
import { sendMail, type MailPayload } from "@/lib/mail";

export const EMAIL_JOB = "send-email";

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

export async function enqueueMail(payload: MailPayload) {
  await ensureInlineMailWorker();
  const boss = await getBoss();
  return boss.send(EMAIL_JOB, payload, {
    retryLimit: 5,
    retryDelay: 30,
    retryBackoff: true,
  });
}

export async function ensureInlineMailWorker() {
  if (globalForBoss.bossWorkerStarted) {
    return globalForBoss.bossWorkerPromise;
  }
  globalForBoss.bossWorkerStarted = true;
  globalForBoss.bossWorkerPromise = (async () => {
    const boss = await getBoss();
    await boss.work<MailPayload>(EMAIL_JOB, async (jobs) => {
      for (const job of jobs) {
        await sendMail(job.data);
      }
    });
  })().catch((error) => {
    globalForBoss.bossWorkerStarted = false;
    globalForBoss.bossWorkerPromise = undefined;
    throw error;
  });
  return globalForBoss.bossWorkerPromise;
}
