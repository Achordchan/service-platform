import "server-only";

import type { Actor } from "@/lib/actor";
import { withActorDb } from "@/lib/actor";
import { dispatchQueuedMailMessage } from "@/lib/jobs";
import { env } from "@/lib/runtime-env";
import { encryptSecret } from "@/lib/secret-crypto";
import { writeAuditLog } from "@/modules/audit/audit-service";
import {
  ensurePlatformSettings,
} from "@/modules/platform-settings/mail-settings-runtime";
import {
  lockPlatformMailSettings,
  migrateQueuedMailForProviderSwitch,
} from "@/modules/platform-settings/mail-provider-lifecycle";
import type { UpdatePlatformSettingsInput } from "@/modules/platform-settings/schemas";
import { DomainError, assertAllowed } from "@/modules/projects/errors";

export type { RuntimeMailSettings } from "@/modules/platform-settings/mail-settings-runtime";
export {
  ensurePlatformSettings,
  getPublicAppUrl,
  getRuntimeMailSettings,
} from "@/modules/platform-settings/mail-settings-runtime";

function emptyToNull(value?: string | null) {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function publicSettings(settings: {
  appUrl: string | null;
  mailMode: "LOCAL_OUTBOX" | "RESEND" | "SMTP";
  mailFrom: string;
  mailReplyTo: string;
  resendApiKeyEncrypted: string | null;
  resendDomain: string;
  resendDomainId: string | null;
  resendDomainStatus: string | null;
  resendDnsRecords: unknown;
  resendWebhookId: string | null;
  resendWebhookStatus: string | null;
  resendWebhookSecretEncrypted: string | null;
  resendLastCheckedAt: Date | null;
  smtpHost: string | null;
  smtpPort: number | null;
  smtpUser: string | null;
  smtpPassword: string | null;
  smtpPasswordEncrypted: string | null;
  smtpFrom: string | null;
  smtpSecure: boolean;
  smtpSecureConfigured: boolean;
  smtpHealthStatus: string | null;
  smtpLastCheckedAt: Date | null;
  smtpLastError: string | null;
  attachmentMaxSizeMb?: number;
  attachmentAllowedExtensions?: string;
  customerReplyAttachmentsEnabled?: boolean;
  standardRequestEmailEnabled?: boolean;
  updatedAt?: Date;
}) {
  return {
    appUrl: settings.appUrl?.trim() || env.APP_URL,
    mailMode: settings.mailMode,
    mailFrom:
      settings.mailFrom?.trim() ||
      "服务支持中心 <no-reply@mail.achord.cn>",
    mailReplyTo: settings.mailReplyTo?.trim() || "support@achord.cn",
    hasDedicatedEncryptionKey: Boolean(
      env.PLATFORM_SECRET_ENCRYPTION_KEY,
    ),
    hasResendApiKey: Boolean(settings.resendApiKeyEncrypted),
    resendDomain: settings.resendDomain || "mail.achord.cn",
    resendDomainId: settings.resendDomainId,
    resendDomainStatus: settings.resendDomainStatus,
    resendDnsRecords: Array.isArray(settings.resendDnsRecords)
      ? settings.resendDnsRecords
      : [],
    resendWebhookId: settings.resendWebhookId,
    resendWebhookStatus: settings.resendWebhookStatus,
    hasResendWebhookSecret: Boolean(
      settings.resendWebhookSecretEncrypted,
    ),
    resendLastCheckedAt:
      settings.resendLastCheckedAt?.toISOString() ?? null,
    smtpHost: settings.smtpHost,
    smtpPort: settings.smtpPort,
    smtpUser: settings.smtpUser,
    smtpPassword: null as string | null,
    smtpFrom:
      settings.smtpFrom?.trim() ||
      env.SMTP_FROM ||
      "服务支持中心 <info@achord.cn>",
    smtpSecure: settings.smtpSecureConfigured
      ? settings.smtpSecure
      : env.SMTP_SECURE ?? settings.smtpSecure,
    hasStoredPassword: Boolean(
      settings.smtpPasswordEncrypted ??
        settings.smtpPassword ??
        env.SMTP_PASSWORD,
    ),
    smtpHealthStatus:
      settings.smtpHealthStatus === "healthy" ||
      settings.smtpHealthStatus === "error" ||
      settings.smtpHealthStatus === "unchecked"
        ? settings.smtpHealthStatus
        : null,
    smtpLastCheckedAt: settings.smtpLastCheckedAt?.toISOString() ?? null,
    smtpLastError: settings.smtpLastError,
    attachmentMaxSizeMb: settings.attachmentMaxSizeMb ?? 20,
    attachmentAllowedExtensions:
      settings.attachmentAllowedExtensions?.trim() ||
      "jpg,jpeg,png,gif,webp,pdf,docx,xlsx,pptx,txt,log,csv,json",
    customerReplyAttachmentsEnabled:
      settings.customerReplyAttachmentsEnabled ?? true,
    standardRequestEmailEnabled:
      settings.standardRequestEmailEnabled ?? false,
    updatedAt: settings.updatedAt?.toISOString(),
  };
}

export async function getPlatformSettings(actor: Actor) {
  assertAllowed(actor.isPlatformAdmin);
  const settings = await ensurePlatformSettings();
  return publicSettings(settings);
}

export async function updatePlatformSettings(
  actor: Actor,
  input: UpdatePlatformSettingsInput,
) {
  assertAllowed(actor.isPlatformAdmin);
  await ensurePlatformSettings();

  const result = await withActorDb(actor, async (tx) => {
    const current = await lockPlatformMailSettings(tx);

    const data: Record<string, unknown> = {
      updatedById: actor.id,
    };
    const providedSmtpPassword = input.smtpPassword?.trim() || null;
    const smtpConfigChanged =
      input.smtpHost !== undefined ||
      input.smtpPort !== undefined ||
      input.smtpUser !== undefined ||
      providedSmtpPassword !== null ||
      input.clearSmtpPassword === true ||
      input.smtpFrom !== undefined ||
      input.smtpSecure !== undefined;

    if (input.appUrl !== undefined) {
      data.appUrl = emptyToNull(input.appUrl);
    }
    if (input.mailMode !== undefined) {
      data.mailMode = input.mailMode;
    }
    if (input.mailFrom !== undefined) {
      data.mailFrom = input.mailFrom.trim();
    }
    if (input.mailReplyTo !== undefined) {
      data.mailReplyTo = input.mailReplyTo.trim().toLowerCase();
    }
    if (input.smtpHost !== undefined) {
      data.smtpHost = emptyToNull(input.smtpHost);
    }
    if (input.smtpPort !== undefined) {
      data.smtpPort = input.smtpPort;
    }
    if (input.smtpUser !== undefined) {
      data.smtpUser = emptyToNull(input.smtpUser);
    }
    if (providedSmtpPassword) {
      if (!env.PLATFORM_SECRET_ENCRYPTION_KEY) {
        throw new DomainError(
          "DEDICATED_ENCRYPTION_KEY_REQUIRED",
          "请先配置 PLATFORM_SECRET_ENCRYPTION_KEY，再保存 SMTP 密码",
          409,
        );
      }
      data.smtpPasswordEncrypted = encryptSecret(providedSmtpPassword);
      data.smtpPassword = null;
    }
    if (input.clearSmtpPassword) {
      data.smtpPasswordEncrypted = null;
      data.smtpPassword = null;
    }
    if (input.smtpFrom !== undefined) {
      data.smtpFrom = emptyToNull(input.smtpFrom);
    }
    if (input.smtpSecure !== undefined) {
      data.smtpSecure = input.smtpSecure;
      data.smtpSecureConfigured = true;
    }
    if (smtpConfigChanged) {
      data.smtpHealthStatus = "unchecked";
      data.smtpLastCheckedAt = null;
      data.smtpLastError = null;
      if (current.mailMode === "SMTP" && input.mailMode === undefined) {
        data.mailMode = "LOCAL_OUTBOX";
        data.standardRequestEmailEnabled = false;
      }
    }
    if (input.attachmentMaxSizeMb !== undefined) {
      data.attachmentMaxSizeMb = input.attachmentMaxSizeMb;
    }
    if (input.attachmentAllowedExtensions !== undefined) {
      data.attachmentAllowedExtensions =
        emptyToNull(input.attachmentAllowedExtensions) ??
        current.attachmentAllowedExtensions;
    }
    if (input.customerReplyAttachmentsEnabled !== undefined) {
      data.customerReplyAttachmentsEnabled =
        input.customerReplyAttachmentsEnabled;
    }
    if (input.standardRequestEmailEnabled !== undefined) {
      data.standardRequestEmailEnabled = input.standardRequestEmailEnabled;
    }

    const nextMailMode =
      (data.mailMode as "LOCAL_OUTBOX" | "RESEND" | "SMTP" | undefined) ??
      current.mailMode;
    if (
      (input.standardRequestEmailEnabled ??
        current.standardRequestEmailEnabled) &&
      nextMailMode === "LOCAL_OUTBOX"
    ) {
      throw new DomainError(
        "STANDARD_REQUEST_EMAIL_REQUIRES_DELIVERY",
        "请先启用 Resend 或 SMTP，再开启站内未读邮件提醒",
        409,
      );
    }
    if (input.mailMode === "LOCAL_OUTBOX") {
      data.standardRequestEmailEnabled = false;
    }
    if (
      input.mailMode === "LOCAL_OUTBOX" &&
      process.env.NODE_ENV === "production"
    ) {
      throw new DomainError(
        "LOCAL_OUTBOX_NOT_AVAILABLE",
        "生产环境不能启用本地发件箱",
        409,
      );
    }
    if (nextMailMode === "RESEND") {
      if (
        !current.resendApiKeyEncrypted ||
        current.resendDomainStatus !== "verified" ||
        !current.resendWebhookId ||
        current.resendWebhookStatus !== "enabled" ||
        !current.resendWebhookSecretEncrypted
      ) {
        throw new DomainError(
          "RESEND_NOT_READY",
          "Resend 域名和 Webhook 尚未配置完成",
          409,
        );
      }
    }
    if (nextMailMode === "SMTP") {
      const smtpHost =
        input.smtpHost === undefined
          ? current.smtpHost ?? env.SMTP_HOST
          : emptyToNull(input.smtpHost);
      const smtpPort =
        input.smtpPort === undefined
          ? current.smtpPort ?? env.SMTP_PORT
          : input.smtpPort;
      const smtpUser =
        input.smtpUser === undefined
          ? current.smtpUser ?? env.SMTP_USER
          : emptyToNull(input.smtpUser);
      const hasSmtpPassword = input.clearSmtpPassword
        ? false
        : Boolean(
            providedSmtpPassword ??
              current.smtpPasswordEncrypted ??
              current.smtpPassword ??
              env.SMTP_PASSWORD,
          );
      const smtpFrom =
        input.smtpFrom === undefined
          ? current.smtpFrom ?? env.SMTP_FROM
          : emptyToNull(input.smtpFrom);
      if (
        !smtpHost ||
        !smtpPort ||
        !smtpUser ||
        !hasSmtpPassword ||
        !smtpFrom
      ) {
        throw new DomainError(
          "SMTP_NOT_READY",
          "SMTP 配置不完整",
          409,
        );
      }
      if (
        input.mailMode === "SMTP" &&
        (smtpConfigChanged || current.smtpHealthStatus !== "healthy")
      ) {
        throw new DomainError(
          "SMTP_CHECK_REQUIRED",
          "请先保存 SMTP 配置并通过连接检测，再启用 SMTP",
          409,
        );
      }
    }

    const redispatch = await migrateQueuedMailForProviderSwitch(
      tx,
      current.mailMode,
      nextMailMode,
    );
    const updated = await tx.platformSetting.update({
      where: { id: 1 },
      data,
    });
    if (
      current.standardRequestEmailEnabled &&
      !updated.standardRequestEmailEnabled
    ) {
      await tx.notification.updateMany({
        where: { emailDueAt: { not: null } },
        data: { emailDueAt: null, emailClaimedAt: null },
      });
      await tx.mailMessage.updateMany({
        where: {
          sourceType: {
            in: [
              "STANDARD_REQUEST_NOTIFICATION",
              "STANDARD_PROJECT_NOTIFICATION",
            ],
          },
          status: "QUEUED",
        },
        data: {
          status: "CANCELLED",
          errorMessage: "平台已关闭站内未读邮件提醒",
        },
      });
    }
    if (
      current.mailMode === "LOCAL_OUTBOX" &&
      updated.mailMode !== "LOCAL_OUTBOX"
    ) {
      await tx.mailMessage.updateMany({
        where: {
          deliveryMode: "LOCAL_OUTBOX",
          status: "QUEUED",
        },
        data: {
          status: "FAILED",
          errorMessage:
            "邮件创建时未启用真实发信通道，请确认后使用当前通道重试",
        },
      });
    }

    await writeAuditLog(tx, actor, {
      action: "PLATFORM_SETTINGS_UPDATED",
      resourceType: "PlatformSetting",
      resourceId: "1",
      metadata: {
        mailMode: updated.mailMode,
        appUrl: updated.appUrl,
        mailFrom: updated.mailFrom,
        mailReplyTo: updated.mailReplyTo,
        smtpHost: updated.smtpHost,
        smtpPort: updated.smtpPort,
        smtpFrom: updated.smtpFrom,
        smtpSecure: updated.smtpSecure,
        passwordChanged: Object.prototype.hasOwnProperty.call(input, "smtpPassword"),
        attachmentMaxSizeMb: updated.attachmentMaxSizeMb,
        attachmentAllowedExtensions: updated.attachmentAllowedExtensions,
        customerReplyAttachmentsEnabled: updated.customerReplyAttachmentsEnabled,
        standardRequestEmailEnabled: updated.standardRequestEmailEnabled,
      },
    });

    return { settings: publicSettings(updated), redispatch };
  });
  for (const message of result.redispatch) {
    await dispatchQueuedMailMessage(
      message.id,
      message.deliveryMode,
      message.sendAfter,
    );
  }
  return result.settings;
}

export async function listMailMessages(actor: Actor, limit = 50) {
  assertAllowed(actor.isPlatformAdmin);
  return withActorDb(actor, (tx) =>
    tx.mailMessage.findMany({
      orderBy: { createdAt: "desc" },
      take: Math.min(Math.max(limit, 1), 200),
    }),
  );
}

export async function getMailOutboxSummary(actor: Actor) {
  assertAllowed(actor.isPlatformAdmin);
  const asOf = new Date();
  const overdueBefore = new Date(asOf.getTime() - 2 * 60 * 1000);
  return withActorDb(actor, async (tx) => {
    const queued = await tx.mailMessage.count({ where: { status: "QUEUED" } });
    const overdue = await tx.mailMessage.count({
      where: {
        status: "QUEUED",
        sendAfter: { lte: overdueBefore },
      },
    });
    const failed = await tx.mailMessage.count({
      where: {
        status: {
          in: ["FAILED", "BOUNCED", "COMPLAINED", "SUPPRESSED"],
        },
      },
    });
    const cancelled = await tx.mailMessage.count({
      where: { status: "CANCELLED" },
    });
    return {
      queued,
      overdue,
      failed,
      cancelled,
      asOf: asOf.toISOString(),
    };
  });
}

export async function getMailMessage(actor: Actor, mailMessageId: string) {
  assertAllowed(actor.isPlatformAdmin);
  return withActorDb(actor, (tx) =>
    tx.mailMessage.findUnique({ where: { id: mailMessageId } }),
  );
}


export async function getRuntimeAttachmentPolicy() {
  const settings = await ensurePlatformSettings();
  return {
    maxSizeMb: settings.attachmentMaxSizeMb ?? 20,
    allowedExtensions: (
      settings.attachmentAllowedExtensions ||
      "jpg,jpeg,png,gif,webp,pdf,docx,xlsx,pptx,txt,log,csv,json"
    )
      .split(",")
      .map((item) => item.trim().toLowerCase().replace(/^\./, ""))
      .filter(Boolean),
    customerReplyAttachmentsEnabled:
      settings.customerReplyAttachmentsEnabled ?? true,
  };
}
