import type { MailDeliveryMode } from "@/generated/prisma/client";
import type { RuntimeMailSettings } from "@/modules/platform-settings/mail-settings-runtime";
import { DomainError } from "@/modules/projects/errors";

export function assertDeliveryModeReady(
  settings: RuntimeMailSettings,
  deliveryMode: MailDeliveryMode,
  production = process.env.NODE_ENV === "production",
) {
  if (deliveryMode === "LOCAL_OUTBOX") {
    if (production) {
      throw new DomainError(
        "MAIL_DELIVERY_NOT_CONFIGURED",
        "邮件服务尚未启用，请先连接并启用 Resend 或配置 SMTP",
        409,
      );
    }
    return;
  }

  if (deliveryMode === "RESEND") {
    if (
      !settings.resendApiKeyEncrypted ||
      settings.resendDomainStatus !== "verified" ||
      !settings.resendWebhookId ||
      settings.resendWebhookStatus !== "enabled" ||
      !settings.hasResendWebhookSecret
    ) {
      throw new DomainError(
        "RESEND_NOT_READY",
        "Resend 尚未完成连接、域名验证或 Webhook 配置",
        409,
      );
    }
    return;
  }

  if (
    !settings.smtpHost ||
    !settings.smtpPort ||
    !settings.smtpUser ||
    !settings.smtpPassword ||
    !settings.smtpFrom
  ) {
    throw new DomainError(
      "SMTP_NOT_READY",
      "SMTP 配置不完整",
      409,
    );
  }
}
