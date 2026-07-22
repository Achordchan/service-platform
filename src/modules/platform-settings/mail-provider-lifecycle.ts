import "server-only";

import type {
  MailDeliveryMode,
  Prisma,
} from "@/generated/prisma/client";
import { env } from "@/lib/runtime-env";
import { DomainError } from "@/modules/projects/errors";

const realDeliveryModes = new Set<MailDeliveryMode>(["RESEND", "SMTP"]);

export type RedispatchMailMessage = {
  id: string;
  deliveryMode: MailDeliveryMode;
  sendAfter: Date;
};

export async function lockPlatformMailSettings(
  tx: Prisma.TransactionClient,
) {
  await tx.$queryRaw`SELECT id FROM "PlatformSetting" WHERE id = 1 FOR UPDATE`;
  return tx.platformSetting.findUniqueOrThrow({ where: { id: 1 } });
}

type LockedMailDeliverySettings = {
  mailMode: MailDeliveryMode;
  resendReady: boolean;
  smtpHostConfigured: boolean;
  smtpPortConfigured: boolean;
  smtpUserConfigured: boolean;
  smtpPasswordConfigured: boolean;
  smtpFromConfigured: boolean;
  smtpHealthStatus: string | null;
};

export async function resolveLockedMailDeliveryMode(
  tx: Prisma.TransactionClient,
  requested?: MailDeliveryMode,
) {
  const [settings] = await tx.$queryRaw<LockedMailDeliverySettings[]>`
    SELECT * FROM app_lock_mail_delivery_settings()
  `;
  if (!settings) {
    throw new DomainError(
      "MAIL_SETTINGS_NOT_FOUND",
      "平台邮件设置不存在",
      500,
    );
  }
  const deliveryMode = requested ?? settings.mailMode;
  if (deliveryMode === "LOCAL_OUTBOX") {
    if (process.env.NODE_ENV === "production") {
      throw new DomainError(
        "MAIL_DELIVERY_NOT_CONFIGURED",
        "生产环境未启用真实邮件发送通道",
        409,
      );
    }
    return deliveryMode;
  }
  if (deliveryMode === "RESEND") {
    if (!settings.resendReady) {
      throw new DomainError(
        "RESEND_NOT_READY",
        "Resend 域名和 Webhook 尚未配置完成",
        409,
      );
    }
    return deliveryMode;
  }
  const smtpReady =
    (settings.smtpHostConfigured || Boolean(env.SMTP_HOST)) &&
    (settings.smtpPortConfigured || Boolean(env.SMTP_PORT)) &&
    (settings.smtpUserConfigured || Boolean(env.SMTP_USER)) &&
    (settings.smtpPasswordConfigured || Boolean(env.SMTP_PASSWORD)) &&
    (settings.smtpFromConfigured || Boolean(env.SMTP_FROM)) &&
    settings.smtpHealthStatus === "healthy";
  if (!smtpReady) {
    throw new DomainError(
      "SMTP_NOT_READY",
      "SMTP 尚未配置完成或未通过连接检测",
      409,
    );
  }
  return deliveryMode;
}

export async function migrateQueuedMailForProviderSwitch(
  tx: Prisma.TransactionClient,
  currentMode: MailDeliveryMode,
  nextMode: MailDeliveryMode,
): Promise<RedispatchMailMessage[]> {
  if (currentMode === nextMode || !realDeliveryModes.has(currentMode)) {
    return [];
  }

  if (!realDeliveryModes.has(nextMode)) {
    await tx.mailMessage.updateMany({
      where: { deliveryMode: currentMode, status: "QUEUED" },
      data: {
        status: "CANCELLED",
        errorMessage: "原邮件通道已暂停，请确认后使用当前通道重试",
      },
    });
    await assertProviderHasNoProcessingMail(tx, currentMode);
    return [];
  }

  const queued = await tx.mailMessage.findMany({
    where: { deliveryMode: currentMode, status: "QUEUED" },
    select: { id: true },
  });
  await tx.mailMessage.updateMany({
    where: { deliveryMode: currentMode, status: "QUEUED" },
    data: {
      deliveryMode: nextMode,
      errorMessage: null,
    },
  });
  await assertProviderHasNoProcessingMail(tx, currentMode);

  if (queued.length === 0) return [];
  return tx.mailMessage.findMany({
    where: {
      id: { in: queued.map((message) => message.id) },
      deliveryMode: nextMode,
      status: "QUEUED",
    },
    select: { id: true, deliveryMode: true, sendAfter: true },
  });
}

export async function prepareMailProviderDisconnect(
  tx: Prisma.TransactionClient,
  deliveryMode: Exclude<MailDeliveryMode, "LOCAL_OUTBOX">,
  reason: string,
) {
  await tx.mailMessage.updateMany({
    where: { deliveryMode, status: "QUEUED" },
    data: {
      status: "CANCELLED",
      errorMessage: reason,
    },
  });
  await assertProviderHasNoProcessingMail(tx, deliveryMode);
}

async function assertProviderHasNoProcessingMail(
  tx: Prisma.TransactionClient,
  deliveryMode: MailDeliveryMode,
) {
  const processing = await tx.mailMessage.count({
    where: { deliveryMode, status: "PROCESSING" },
  });
  if (processing > 0) {
    throw new DomainError(
      "MAIL_PROVIDER_HAS_PROCESSING_MESSAGES",
      "当前邮件通道仍有邮件正在发送，请稍后重试",
      409,
    );
  }
}
