import { env } from "@/lib/runtime-env";
import { withSystemDb } from "@/lib/system-db";

export type RuntimeMailSettings = {
  appUrl: string;
  mailMode: "LOCAL_OUTBOX" | "SMTP";
  smtpHost: string | null;
  smtpPort: number | null;
  smtpUser: string | null;
  smtpPassword: string | null;
  smtpFrom: string;
  smtpSecure: boolean;
  hasStoredPassword: boolean;
};

export async function ensurePlatformSettings() {
  return withSystemDb(async (tx) => {
    const existing = await tx.platformSetting.findUnique({ where: { id: 1 } });
    if (existing) return existing;
    return tx.platformSetting.create({
      data: {
        id: 1,
        appUrl: env.APP_URL,
        mailMode: "LOCAL_OUTBOX",
        smtpHost: env.SMTP_HOST ?? null,
        smtpPort: env.SMTP_PORT ?? null,
        smtpUser: env.SMTP_USER ?? null,
        smtpPassword: env.SMTP_PASSWORD ?? null,
        smtpFrom: env.SMTP_FROM ?? "服务支持中心 <info@achord.cn>",
        smtpSecure: env.SMTP_SECURE ?? false,
      },
    });
  });
}

export async function getRuntimeMailSettings(): Promise<RuntimeMailSettings> {
  const settings = await ensurePlatformSettings();
  return {
    appUrl: settings.appUrl?.trim() || env.APP_URL,
    mailMode: settings.mailMode,
    smtpHost: settings.smtpHost ?? env.SMTP_HOST ?? null,
    smtpPort: settings.smtpPort ?? env.SMTP_PORT ?? null,
    smtpUser: settings.smtpUser ?? env.SMTP_USER ?? null,
    smtpPassword: settings.smtpPassword ?? env.SMTP_PASSWORD ?? null,
    smtpFrom:
      settings.smtpFrom?.trim() ||
      env.SMTP_FROM ||
      "服务支持中心 <info@achord.cn>",
    smtpSecure: settings.smtpSecure || Boolean(env.SMTP_SECURE),
    hasStoredPassword: Boolean(settings.smtpPassword ?? env.SMTP_PASSWORD),
  };
}

export async function getPublicAppUrl() {
  const settings = await getRuntimeMailSettings();
  return settings.appUrl.replace(/\/$/, "");
}
