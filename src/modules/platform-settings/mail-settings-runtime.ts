import { env } from "@/lib/runtime-env";
import { decryptSecret, encryptSecret } from "@/lib/secret-crypto";
import { withSystemDb } from "@/lib/system-db";
import { formatSmtpSender } from "@/modules/platform-settings/smtp-sender";

export type RuntimeMailSettings = {
  appUrl: string;
  mailMode: "LOCAL_OUTBOX" | "RESEND" | "SMTP";
  mailFrom: string;
  resendApiKeyEncrypted: string | null;
  resendDomain: string;
  resendDomainId: string | null;
  resendDomainStatus: string | null;
  resendWebhookId: string | null;
  resendWebhookStatus: string | null;
  hasResendWebhookSecret: boolean;
  smtpHost: string | null;
  smtpPort: number | null;
  smtpUser: string | null;
  smtpPassword: string | null;
  smtpFrom: string;
  smtpSecure: boolean;
  hasStoredPassword: boolean;
  smtpHealthStatus: string | null;
  smtpLastCheckedAt: Date | null;
  smtpLastError: string | null;
  standardEmailUnreadDelayEnabled: boolean;
  emailOtpLoginEnabled: boolean;
};

type StoredMailSettings = Awaited<ReturnType<typeof ensurePlatformSettings>>;

export async function ensurePlatformSettings() {
  return withSystemDb(async (tx) => {
    const existing = await tx.platformSetting.findUnique({ where: { id: 1 } });
    if (existing) {
      if (existing.smtpPassword) {
        return tx.platformSetting.update({
          where: { id: 1 },
          data: {
            smtpPasswordEncrypted:
              existing.smtpPasswordEncrypted ??
              encryptSecret(existing.smtpPassword),
            smtpPassword: null,
          },
        });
      }
      return existing;
    }
    return tx.platformSetting.create({
      data: {
        id: 1,
        appUrl: env.APP_URL,
        mailMode: "LOCAL_OUTBOX",
        mailFrom: "服务支持中心 <no-reply@mail.achord.cn>",
        resendDomain: "mail.achord.cn",
        smtpHost: env.SMTP_HOST ?? null,
        smtpPort: env.SMTP_PORT ?? null,
        smtpUser: env.SMTP_USER ?? null,
        smtpPasswordEncrypted: env.SMTP_PASSWORD
          ? encryptSecret(env.SMTP_PASSWORD)
          : null,
        smtpFrom:
          env.SMTP_FROM ??
          (env.SMTP_USER
            ? formatSmtpSender("服务支持中心", env.SMTP_USER)
            : null),
        smtpSecure: env.SMTP_SECURE ?? false,
        smtpSecureConfigured: env.SMTP_SECURE !== undefined,
      },
    });
  });
}

export async function getRuntimeMailSettings(): Promise<RuntimeMailSettings> {
  const settings = await ensurePlatformSettings();
  return runtimeMailSettingsFromStored(settings);
}

export function runtimeMailSettingsFromStored(
  settings: StoredMailSettings,
): RuntimeMailSettings {
  const smtpUser = settings.smtpUser ?? env.SMTP_USER ?? null;
  return {
    appUrl: settings.appUrl?.trim() || env.APP_URL,
    mailMode: settings.mailMode,
    mailFrom:
      settings.mailFrom?.trim() ||
      "服务支持中心 <no-reply@mail.achord.cn>",
    resendApiKeyEncrypted: settings.resendApiKeyEncrypted,
    resendDomain: settings.resendDomain || "mail.achord.cn",
    resendDomainId: settings.resendDomainId,
    resendDomainStatus: settings.resendDomainStatus,
    resendWebhookId: settings.resendWebhookId,
    resendWebhookStatus: settings.resendWebhookStatus,
    hasResendWebhookSecret: Boolean(
      settings.resendWebhookSecretEncrypted,
    ),
    smtpHost: settings.smtpHost ?? env.SMTP_HOST ?? null,
    smtpPort: settings.smtpPort ?? env.SMTP_PORT ?? null,
    smtpUser,
    smtpPassword: settings.smtpPasswordEncrypted
      ? decryptSecret(settings.smtpPasswordEncrypted)
      : settings.smtpPassword ?? env.SMTP_PASSWORD ?? null,
    smtpFrom:
      settings.smtpFrom?.trim() ||
      env.SMTP_FROM ||
      (smtpUser ? formatSmtpSender("服务支持中心", smtpUser) : ""),
    smtpSecure: settings.smtpSecureConfigured
      ? settings.smtpSecure
      : env.SMTP_SECURE ?? settings.smtpSecure,
    hasStoredPassword: Boolean(
      settings.smtpPasswordEncrypted ??
        settings.smtpPassword ??
        env.SMTP_PASSWORD,
    ),
    smtpHealthStatus: settings.smtpHealthStatus,
    smtpLastCheckedAt: settings.smtpLastCheckedAt,
    smtpLastError: settings.smtpLastError,
    standardEmailUnreadDelayEnabled:
      settings.standardRequestEmailEnabled ?? false,
    emailOtpLoginEnabled: settings.emailOtpLoginEnabled ?? false,
  };
}

export async function getPublicAppUrl() {
  const settings = await getRuntimeMailSettings();
  return settings.appUrl.replace(/\/$/, "");
}
