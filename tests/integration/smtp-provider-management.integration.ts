import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Pool } from "pg";
import { type Actor, withActorDb } from "@/lib/actor";
import {
  assertMailDeliveryReady,
  createMailMessageInTx,
  dispatchQueuedMailMessage,
} from "@/lib/jobs";
import { encryptSecret } from "@/lib/secret-crypto";
import { ensurePlatformSettings } from "@/modules/platform-settings/mail-settings-runtime";
import { assertEmailOtpLoginAvailable } from "@/modules/platform-settings/email-otp-login-service";
import { updatePlatformSettings } from "@/modules/platform-settings/platform-setting-service";
import { checkSmtpProvider } from "@/modules/platform-settings/smtp-provider-service";

const smtpTransportMock = vi.hoisted(() => ({
  verify: vi.fn(),
  close: vi.fn(),
}));

vi.mock("@/lib/jobs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/jobs")>();
  return {
    ...actual,
    dispatchQueuedMailMessage: vi.fn().mockResolvedValue("test-mail-job"),
  };
});

vi.mock("@/modules/platform-settings/smtp-transport", () => ({
  createSmtpTransport: vi.fn(() => smtpTransportMock),
}));

const pool = new Pool({
  connectionString: process.env.DATABASE_MIGRATION_URL,
  max: 1,
});

let admin: Actor;
let original: Record<string, unknown>;
const mailMessageIds: string[] = [];

beforeAll(async () => {
  const adminResult = await pool.query<{
    id: string;
    name: string;
    email: string;
  }>(
    `SELECT id, name, email
       FROM "User"
      WHERE "platformRole" = 'PLATFORM_ADMIN'
      ORDER BY "createdAt" ASC
      LIMIT 1`,
  );
  const row = adminResult.rows[0];
  if (!row) {
    throw new Error("请先执行 pnpm test:integration:prepare 准备测试数据库");
  }
  admin = {
    id: row.id,
    name: row.name,
    email: row.email,
    platformRole: "PLATFORM_ADMIN",
    isPlatformAdmin: true,
    isStaff: true,
  };
  const settings = await pool.query(
    `SELECT * FROM "PlatformSetting" WHERE id = 1`,
  );
  original = settings.rows[0] ?? {};
});

afterAll(async () => {
  await pool.query(
    `UPDATE "PlatformSetting"
        SET "smtpHost" = $1,
            "smtpPort" = $2,
            "smtpUser" = $3,
            "smtpPassword" = $4,
            "smtpPasswordEncrypted" = $5,
            "smtpFrom" = $6,
            "smtpSecure" = $7,
            "smtpSecureConfigured" = $8,
            "smtpHealthStatus" = $9,
            "smtpLastCheckedAt" = $10,
            "smtpLastError" = $11,
            "mailMode" = $12::"MailDeliveryMode",
            "standardRequestEmailEnabled" = $13,
            "resendApiKeyEncrypted" = $14,
            "resendDomainStatus" = $15,
            "resendWebhookId" = $16,
            "resendWebhookStatus" = $17,
            "resendWebhookSecretEncrypted" = $18,
            "emailOtpLoginEnabled" = $19,
            "updatedAt" = NOW()
      WHERE id = 1`,
    [
      original.smtpHost ?? null,
      original.smtpPort ?? null,
      original.smtpUser ?? null,
      original.smtpPassword ?? null,
      original.smtpPasswordEncrypted ?? null,
      original.smtpFrom ?? null,
      original.smtpSecure ?? false,
      original.smtpSecureConfigured ?? false,
      original.smtpHealthStatus ?? null,
      original.smtpLastCheckedAt ?? null,
      original.smtpLastError ?? null,
      original.mailMode ?? "LOCAL_OUTBOX",
      original.standardRequestEmailEnabled ?? false,
      original.resendApiKeyEncrypted ?? null,
      original.resendDomainStatus ?? null,
      original.resendWebhookId ?? null,
      original.resendWebhookStatus ?? null,
      original.resendWebhookSecretEncrypted ?? null,
      original.emailOtpLoginEnabled ?? false,
    ],
  );
  if (mailMessageIds.length > 0) {
    await pool.query('DELETE FROM "MailMessage" WHERE id = ANY($1::text[])', [
      mailMessageIds,
    ]);
  }
  await pool.end();
});

describe("SMTP 通道管理", () => {
  it("读取平台设置时会自动加密并清除历史 SMTP 明文密码", async () => {
    await pool.query(
      `UPDATE "PlatformSetting"
          SET "smtpPassword" = 'legacy-plain-password',
              "smtpPasswordEncrypted" = NULL
        WHERE id = 1`,
    );
    const settings = await ensurePlatformSettings();
    expect(settings.smtpPassword).toBeNull();
    expect(settings.smtpPasswordEncrypted).toMatch(/^v1:/);
    const stored = await pool.query<{
      password: string | null;
      encrypted: string | null;
    }>(
      `SELECT "smtpPassword" AS password,
              "smtpPasswordEncrypted" AS encrypted
         FROM "PlatformSetting"
        WHERE id = 1`,
    );
    expect(stored.rows[0]?.password).toBeNull();
    expect(stored.rows[0]?.encrypted).toMatch(/^v1:/);
  });

  it("加密保存凭据，检测通过前禁止启用，并在修改活动配置后暂停发送", async () => {
    await pool.query(
      `UPDATE "PlatformSetting"
          SET "mailMode" = 'LOCAL_OUTBOX',
              "standardRequestEmailEnabled" = false
        WHERE id = 1`,
    );

    const saved = await updatePlatformSettings(admin, {
      smtpHost: "smtp.test.example",
      smtpPort: 587,
      smtpUser: "mailer@test.example",
      smtpPassword: "smtp-test-secret",
      smtpFrom: "测试服务 <mailer@test.example>",
      smtpSecure: false,
    });
    expect(saved.mailMode).toBe("LOCAL_OUTBOX");
    expect(saved.hasStoredPassword).toBe(true);
    expect(saved.smtpHealthStatus).toBe("unchecked");

    const stored = await pool.query<{
      password: string | null;
      encrypted: string | null;
    }>(
      `SELECT "smtpPassword" AS password,
              "smtpPasswordEncrypted" AS encrypted
         FROM "PlatformSetting"
        WHERE id = 1`,
    );
    expect(stored.rows[0]?.password).toBeNull();
    expect(stored.rows[0]?.encrypted).toMatch(/^v1:/);

    await expect(
      updatePlatformSettings(admin, { mailMode: "SMTP" }),
    ).rejects.toMatchObject({ code: "SMTP_CHECK_REQUIRED" });

    await pool.query(
      `UPDATE "PlatformSetting"
          SET "smtpHealthStatus" = 'healthy',
              "smtpLastCheckedAt" = NOW(),
              "smtpLastError" = NULL
        WHERE id = 1`,
    );
    const enabled = await updatePlatformSettings(admin, { mailMode: "SMTP" });
    expect(enabled.mailMode).toBe("SMTP");
    const otpEnabled = await updatePlatformSettings(admin, {
      emailOtpLoginEnabled: true,
    });
    expect(otpEnabled.emailOtpLoginEnabled).toBe(true);
    await expect(assertEmailOtpLoginAvailable()).resolves.toBe("SMTP");

    const changed = await updatePlatformSettings(admin, {
      smtpHost: "smtp-updated.test.example",
    });
    expect(changed.mailMode).toBe("LOCAL_OUTBOX");
    expect(changed.smtpHealthStatus).toBe("unchecked");
    expect(changed.standardEmailUnreadDelayEnabled).toBe(false);
    expect(changed.emailOtpLoginEnabled).toBe(false);
  });

  it("QQ SMTP 检测会拒绝与登录账号不一致的发件邮箱", async () => {
    smtpTransportMock.verify.mockReset();
    smtpTransportMock.close.mockReset();
    await pool.query(
      `UPDATE "PlatformSetting"
          SET "mailMode" = 'LOCAL_OUTBOX',
              "smtpHost" = 'smtp.qq.com',
              "smtpPort" = 465,
              "smtpUser" = 'service@qq.com',
              "smtpPassword" = NULL,
              "smtpPasswordEncrypted" = $1,
              "smtpFrom" = '服务支持中心 <info@achord.cn>',
              "smtpSecure" = true,
              "smtpSecureConfigured" = true,
              "smtpHealthStatus" = 'unchecked',
              "smtpLastCheckedAt" = NULL,
              "smtpLastError" = NULL
        WHERE id = 1`,
      [encryptSecret("smtp-test-secret")],
    );

    await expect(checkSmtpProvider(admin)).rejects.toMatchObject({
      code: "SMTP_CHECK_FAILED",
      message: expect.stringContaining("当前 QQ 邮箱"),
    });
    expect(smtpTransportMock.verify).not.toHaveBeenCalled();

    const stored = await pool.query<{
      smtpHealthStatus: string | null;
      smtpLastError: string | null;
    }>(
      `SELECT "smtpHealthStatus", "smtpLastError"
         FROM "PlatformSetting"
        WHERE id = 1`,
    );
    expect(stored.rows[0]).toMatchObject({
      smtpHealthStatus: "error",
      smtpLastError: expect.stringContaining("当前 QQ 邮箱"),
    });
  });

  it("切换真实发信通道时迁移排队邮件，并在存在在途邮件时拒绝切换", async () => {
    vi.mocked(dispatchQueuedMailMessage).mockClear();
    await configureBothProviders("SMTP");
    const queuedId = await insertMailMessage("QUEUED", "SMTP");

    const switched = await updatePlatformSettings(admin, {
      mailMode: "RESEND",
    });
    expect(switched.mailMode).toBe("RESEND");
    const migrated = await pool.query<{ deliveryMode: string; status: string }>(
      `SELECT "deliveryMode"::text, status::text
         FROM "MailMessage" WHERE id = $1`,
      [queuedId],
    );
    expect(migrated.rows[0]).toEqual({
      deliveryMode: "RESEND",
      status: "QUEUED",
    });
    expect(dispatchQueuedMailMessage).toHaveBeenCalledWith(
      queuedId,
      "RESEND",
      expect.any(Date),
    );

    await configureBothProviders("SMTP");
    const processingId = await insertMailMessage("PROCESSING", "SMTP");
    await expect(
      updatePlatformSettings(admin, { mailMode: "RESEND" }),
    ).rejects.toMatchObject({
      code: "MAIL_PROVIDER_HAS_PROCESSING_MESSAGES",
    });
    const unchanged = await pool.query<{ mailMode: string }>(
      `SELECT "mailMode"::text FROM "PlatformSetting" WHERE id = 1`,
    );
    expect(unchanged.rows[0]?.mailMode).toBe("SMTP");
    await pool.query('DELETE FROM "MailMessage" WHERE id = $1', [processingId]);
  });

  it("SMTP 检测期间配置变化时不会把旧检测结果写入新配置", async () => {
    await configureBothProviders("SMTP");
    smtpTransportMock.verify.mockReset();
    smtpTransportMock.close.mockReset();
    let finishVerification: (() => void) | undefined;
    smtpTransportMock.verify.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishVerification = resolve;
        }),
    );

    const checking = checkSmtpProvider(admin);
    await vi.waitFor(() => {
      expect(smtpTransportMock.verify).toHaveBeenCalledTimes(1);
      expect(finishVerification).toBeTypeOf("function");
    });
    await pool.query(
      `UPDATE "PlatformSetting"
          SET "smtpHost" = 'smtp.changed.example',
              "smtpHealthStatus" = 'unchecked',
              "smtpLastCheckedAt" = NULL,
              "smtpLastError" = NULL
        WHERE id = 1`,
    );
    finishVerification!();

    await expect(checking).rejects.toMatchObject({
      code: "SMTP_CONFIGURATION_CHANGED",
    });
    const stored = await pool.query<{
      smtpHost: string | null;
      smtpHealthStatus: string | null;
      smtpLastCheckedAt: Date | null;
    }>(
      `SELECT "smtpHost", "smtpHealthStatus", "smtpLastCheckedAt"
         FROM "PlatformSetting" WHERE id = 1`,
    );
    expect(stored.rows[0]).toMatchObject({
      smtpHost: "smtp.changed.example",
      smtpHealthStatus: "unchecked",
      smtpLastCheckedAt: null,
    });
  });

  it("业务预检后发生通道切换时，事务内邮件使用最新活动通道", async () => {
    await configureBothProviders("SMTP");
    await expect(assertMailDeliveryReady()).resolves.toBe("SMTP");
    await updatePlatformSettings(admin, { mailMode: "RESEND" });

    const message = await withActorDb(admin, (tx) =>
      createMailMessageInTx(tx, {
        to: "provider-race@local.test",
        templateKey: "TEST_EMAIL",
        variables: {},
      }),
    );
    mailMessageIds.push(message.id);
    expect(message.deliveryMode).toBe("RESEND");
  });
});

async function configureBothProviders(mailMode: "SMTP" | "RESEND") {
  await pool.query(
    `UPDATE "PlatformSetting"
        SET "mailMode" = $1::"MailDeliveryMode",
            "smtpHost" = 'smtp.test.example',
            "smtpPort" = 587,
            "smtpUser" = 'mailer@test.example',
            "smtpPassword" = NULL,
            "smtpPasswordEncrypted" = $2,
            "smtpFrom" = '测试服务 <mailer@test.example>',
            "smtpSecure" = false,
            "smtpSecureConfigured" = true,
            "smtpHealthStatus" = 'healthy',
            "resendApiKeyEncrypted" = $3,
            "resendDomainStatus" = 'verified',
            "resendWebhookId" = 'webhook-test',
            "resendWebhookStatus" = 'enabled',
            "resendWebhookSecretEncrypted" = $4
      WHERE id = 1`,
    [
      mailMode,
      encryptSecret("smtp-test-secret"),
      encryptSecret("re_test_key"),
      encryptSecret("whsec_test"),
    ],
  );
}

async function insertMailMessage(
  status: "QUEUED" | "PROCESSING",
  deliveryMode: "SMTP" | "RESEND",
) {
  const id = randomUUID();
  mailMessageIds.push(id);
  await pool.query(
    `INSERT INTO "MailMessage" (
       id, "toEmail", subject, heading, body, "deliveryMode", status, "updatedAt"
     ) VALUES ($1, 'provider-switch@local.test', '通道切换测试', '测试', '测试正文', $2, $3, NOW())`,
    [id, deliveryMode, status],
  );
  return id;
}
