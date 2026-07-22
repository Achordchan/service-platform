import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Pool } from "pg";
import type { Actor } from "@/lib/actor";
import { queueMailMessage } from "@/lib/jobs";
import { processMailMessage } from "@/lib/mail";
import {
  cancelMailMessage,
  retryMailMessage,
} from "@/modules/platform-settings/mail-message-service";

vi.mock("@/lib/jobs", () => ({
  queueMailMessage: vi.fn().mockResolvedValue("job-id"),
}));

const ownerPool = new Pool({
  connectionString: process.env.DATABASE_MIGRATION_URL,
  max: 1,
});

const fixture = {
  queuedId: randomUUID(),
  failedId: randomUUID(),
  localDeliveryId: randomUUID(),
  processingId: randomUUID(),
  modeMismatchId: randomUUID(),
  resendExhaustedId: randomUUID(),
};

let admin: Actor;

beforeAll(async () => {
  const result = await ownerPool.query<{
    id: string;
    name: string;
    email: string;
    platformRole: Actor["platformRole"];
  }>(
    `
      SELECT id, name, email, "platformRole"
      FROM "User"
      WHERE email = 'admin@local.test'
      LIMIT 1
    `,
  );
  const user = result.rows[0];
  if (!user) {
    throw new Error("请先执行 pnpm test:integration:prepare 创建管理员测试账号");
  }
  admin = {
    ...user,
    isPlatformAdmin: true,
    isStaff: true,
  };

  await insertMessage(fixture.queuedId, "QUEUED", "LOCAL_OUTBOX");
  await insertMessage(fixture.failedId, "FAILED", "LOCAL_OUTBOX");
  await insertMessage(
    fixture.localDeliveryId,
    "QUEUED",
    "LOCAL_OUTBOX",
  );
  await insertMessage(fixture.processingId, "PROCESSING", "RESEND");
  await insertMessage(fixture.modeMismatchId, "QUEUED", "RESEND");
  await insertMessage(fixture.resendExhaustedId, "QUEUED", "RESEND", 6);
});

afterAll(async () => {
  await ownerPool.query(
    'DELETE FROM "AuditLog" WHERE "resourceId" = ANY($1::text[])',
    [[
      fixture.queuedId,
      fixture.failedId,
      fixture.localDeliveryId,
      fixture.processingId,
      fixture.modeMismatchId,
      fixture.resendExhaustedId,
    ]],
  );
  await ownerPool.query(
    'DELETE FROM "MailMessage" WHERE id = ANY($1::text[])',
    [[
      fixture.queuedId,
      fixture.failedId,
      fixture.localDeliveryId,
      fixture.processingId,
      fixture.modeMismatchId,
      fixture.resendExhaustedId,
    ]],
  );
  await ownerPool.end();
});

describe("mail message controls", () => {
  it("cancels queued mail without allowing the pending job to send", async () => {
    const cancelled = await cancelMailMessage(admin, fixture.queuedId);

    expect(cancelled.status).toBe("CANCELLED");
    expect(cancelled.errorMessage).toBe("管理员已取消发送");
    await expect(
      processMailMessage(fixture.queuedId, { finalAttempt: true }),
    ).resolves.toEqual({
      id: fixture.queuedId,
      skipped: true,
    });
  });

  it("requeues failed mail with the currently active delivery mode", async () => {
    const queued = await retryMailMessage(admin, fixture.failedId);

    expect(queued.status).toBe("QUEUED");
    expect(queued.deliveryMode).toBe("LOCAL_OUTBOX");
    expect(queued.attemptCount).toBe(0);
    expect(queueMailMessage).toHaveBeenCalledWith(
      fixture.failedId,
      "LOCAL_OUTBOX",
    );
  });

  it("does not cancel or retry a message that is already being processed", async () => {
    await expect(
      cancelMailMessage(admin, fixture.processingId),
    ).rejects.toThrow("只有排队中的邮件可以取消");
    await expect(
      retryMailMessage(admin, fixture.processingId),
    ).rejects.toThrow("当前邮件状态不允许重试");
  });

  it("ignores an obsolete provider job after the queued message changes mode", async () => {
    await expect(
      processMailMessage(fixture.modeMismatchId, {
        finalAttempt: true,
        expectedDeliveryMode: "SMTP",
      }),
    ).resolves.toEqual({
      id: fixture.modeMismatchId,
      skipped: true,
    });
    const result = await ownerPool.query<{ status: string }>(
      `SELECT status::text FROM "MailMessage" WHERE id = $1`,
      [fixture.modeMismatchId],
    );
    expect(result.rows[0]?.status).toBe("QUEUED");
  });

  it("does not let replacement jobs exceed the global Resend attempt limit", async () => {
    await expect(
      processMailMessage(fixture.resendExhaustedId, {
        finalAttempt: false,
        expectedDeliveryMode: "RESEND",
      }),
    ).resolves.toEqual({
      id: fixture.resendExhaustedId,
      skipped: true,
    });
    const result = await ownerPool.query<{
      status: string;
      attemptCount: number;
      errorMessage: string | null;
    }>(
      `SELECT status::text, "attemptCount", "errorMessage"
         FROM "MailMessage" WHERE id = $1`,
      [fixture.resendExhaustedId],
    );
    expect(result.rows[0]).toEqual({
      status: "FAILED",
      attemptCount: 6,
      errorMessage: "邮件发送已达到重试上限",
    });
  });

  it("marks production local-outbox jobs as failed instead of pretending to send", async () => {
    vi.stubEnv("NODE_ENV", "production");
    try {
      await expect(
        processMailMessage(fixture.localDeliveryId, {
          finalAttempt: true,
        }),
      ).rejects.toThrow("未启用真实发信通道");
    } finally {
      vi.unstubAllEnvs();
    }

    const result = await ownerPool.query<{
      status: string;
      attemptCount: number;
      errorMessage: string | null;
    }>(
      `
        SELECT status, "attemptCount", "errorMessage"
        FROM "MailMessage"
        WHERE id = $1
      `,
      [fixture.localDeliveryId],
    );
    expect(result.rows[0]).toEqual({
      status: "FAILED",
      attemptCount: 1,
      errorMessage: "邮件创建时未启用真实发信通道，未实际发送",
    });
  });
});

async function insertMessage(
  id: string,
  status: "QUEUED" | "PROCESSING" | "FAILED",
  deliveryMode: "LOCAL_OUTBOX" | "RESEND",
  attemptCount = 0,
) {
  await ownerPool.query(
    `
      INSERT INTO "MailMessage" (
        id,
        "toEmail",
        subject,
        heading,
        body,
        "deliveryMode",
        status,
        "attemptCount",
        "updatedAt"
      )
      VALUES ($1, 'queue-control@local.test', '队列控制测试', '测试', '测试正文', $2, $3, $4, NOW())
    `,
    [id, deliveryMode, status, attemptCount],
  );
}
