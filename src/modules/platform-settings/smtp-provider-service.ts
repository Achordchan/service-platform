import "server-only";

import type { Actor } from "@/lib/actor";
import { withActorDb } from "@/lib/actor";
import { writeAuditLog } from "@/modules/audit/audit-service";
import {
  ensurePlatformSettings,
  runtimeMailSettingsFromStored,
} from "@/modules/platform-settings/mail-settings-runtime";
import { getPlatformSettings } from "@/modules/platform-settings/platform-setting-service";
import {
  lockPlatformMailSettings,
  prepareMailProviderDisconnect,
} from "@/modules/platform-settings/mail-provider-lifecycle";
import {
  createSmtpTransport,
} from "@/modules/platform-settings/smtp-transport";
import { describeSmtpError } from "@/modules/platform-settings/smtp-error";
import { assertAllowed, DomainError } from "@/modules/projects/errors";

export async function checkSmtpProvider(actor: Actor) {
  assertAllowed(actor.isPlatformAdmin);
  const snapshot = await ensurePlatformSettings();
  const settings = runtimeMailSettingsFromStored(snapshot);
  if (
    !settings.smtpHost ||
    !settings.smtpPort ||
    !settings.smtpUser ||
    !settings.smtpPassword ||
    !settings.smtpFrom
  ) {
    throw new DomainError("SMTP_NOT_READY", "请先完整保存 SMTP 配置", 409);
  }

  const checkedAt = new Date();
  const transporter = createSmtpTransport({
    smtpHost: settings.smtpHost,
    smtpPort: settings.smtpPort,
    smtpUser: settings.smtpUser,
    smtpPassword: settings.smtpPassword,
    smtpSecure: settings.smtpSecure,
  });
  let checkError: unknown = null;
  try {
    await transporter.verify();
  } catch (error) {
    checkError = error;
  } finally {
    transporter.close();
  }

  const message = checkError ? describeSmtpError(checkError) : null;
  await withActorDb(actor, async (tx) => {
    const current = runtimeMailSettingsFromStored(
      await lockPlatformMailSettings(tx),
    );
    if (!sameSmtpConfiguration(settings, current)) {
      throw new DomainError(
        "SMTP_CONFIGURATION_CHANGED",
        "SMTP 配置已在检测期间发生变化，请重新检测",
        409,
      );
    }
    await tx.platformSetting.update({
      where: { id: 1 },
      data: {
        smtpHealthStatus: checkError ? "error" : "healthy",
        smtpLastCheckedAt: checkedAt,
        smtpLastError: message,
        updatedById: actor.id,
      },
    });
    await writeAuditLog(tx, actor, {
      action: "SMTP_PROVIDER_CHECKED",
      resourceType: "PlatformSetting",
      resourceId: "1",
      metadata: {
        host: settings.smtpHost,
        port: settings.smtpPort,
        secure: settings.smtpSecure,
        result: checkError ? "error" : "healthy",
      },
    });
  });

  if (checkError) {
    throw new DomainError("SMTP_CHECK_FAILED", message!, 422);
  }

  return getPlatformSettings(actor);
}

function sameSmtpConfiguration(
  left: ReturnType<typeof runtimeMailSettingsFromStored>,
  right: ReturnType<typeof runtimeMailSettingsFromStored>,
) {
  return (
    left.smtpHost === right.smtpHost &&
    left.smtpPort === right.smtpPort &&
    left.smtpUser === right.smtpUser &&
    left.smtpPassword === right.smtpPassword &&
    left.smtpFrom === right.smtpFrom &&
    left.smtpSecure === right.smtpSecure
  );
}

export async function disconnectSmtpProvider(actor: Actor) {
  assertAllowed(actor.isPlatformAdmin);
  await ensurePlatformSettings();
  await withActorDb(actor, async (tx) => {
    const current = await lockPlatformMailSettings(tx);
    await prepareMailProviderDisconnect(tx, "SMTP", "SMTP 已停用");
    await tx.platformSetting.update({
      where: { id: 1 },
      data: {
        mailMode:
          current.mailMode === "SMTP" ? "LOCAL_OUTBOX" : current.mailMode,
        standardRequestEmailEnabled:
          current.mailMode === "SMTP"
            ? false
            : current.standardRequestEmailEnabled,
        smtpHost: null,
        smtpPort: null,
        smtpUser: null,
        smtpPassword: null,
        smtpPasswordEncrypted: null,
        smtpFrom: null,
        smtpSecure: false,
        smtpSecureConfigured: false,
        smtpHealthStatus: null,
        smtpLastCheckedAt: null,
        smtpLastError: null,
        updatedById: actor.id,
      },
    });
    if (current.mailMode === "SMTP") {
      await tx.notification.updateMany({
        where: { emailDueAt: { not: null } },
        data: { emailDueAt: null, emailClaimedAt: null },
      });
    }
    await writeAuditLog(tx, actor, {
      action: "SMTP_PROVIDER_DISCONNECTED",
      resourceType: "PlatformSetting",
      resourceId: "1",
      metadata: {
        host: current.smtpHost,
        switchedToLocalOutbox: current.mailMode === "SMTP",
      },
    });
  });
  return getPlatformSettings(actor);
}
