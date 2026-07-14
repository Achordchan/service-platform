import "server-only";

import type { Actor } from "@/lib/actor";
import { withActorDb } from "@/lib/actor";
import { env } from "@/lib/runtime-env";
import { writeAuditLog } from "@/modules/audit/audit-service";
import {
  ensurePlatformSettings,
} from "@/modules/platform-settings/mail-settings-runtime";
import type { UpdatePlatformSettingsInput } from "@/modules/platform-settings/schemas";
import { assertAllowed } from "@/modules/projects/errors";

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
  mailMode: "LOCAL_OUTBOX" | "SMTP";
  smtpHost: string | null;
  smtpPort: number | null;
  smtpUser: string | null;
  smtpPassword: string | null;
  smtpFrom: string | null;
  smtpSecure: boolean;
  attachmentMaxSizeMb?: number;
  attachmentAllowedExtensions?: string;
  customerReplyAttachmentsEnabled?: boolean;
  updatedAt?: Date;
}) {
  return {
    appUrl: settings.appUrl?.trim() || env.APP_URL,
    mailMode: settings.mailMode,
    smtpHost: settings.smtpHost,
    smtpPort: settings.smtpPort,
    smtpUser: settings.smtpUser,
    smtpPassword: null as string | null,
    smtpFrom:
      settings.smtpFrom?.trim() ||
      env.SMTP_FROM ||
      "服务支持中心 <info@achord.cn>",
    smtpSecure: settings.smtpSecure,
    hasStoredPassword: Boolean(settings.smtpPassword),
    attachmentMaxSizeMb: settings.attachmentMaxSizeMb ?? 20,
    attachmentAllowedExtensions:
      settings.attachmentAllowedExtensions?.trim() ||
      "jpg,jpeg,png,gif,webp,pdf,docx,xlsx,pptx,txt,log,csv,json",
    customerReplyAttachmentsEnabled:
      settings.customerReplyAttachmentsEnabled ?? true,
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

  return withActorDb(actor, async (tx) => {
    const current = await tx.platformSetting.findUniqueOrThrow({
      where: { id: 1 },
    });

    const data: Record<string, unknown> = {
      updatedById: actor.id,
    };

    if (input.appUrl !== undefined) {
      data.appUrl = emptyToNull(input.appUrl);
    }
    if (input.mailMode !== undefined) {
      data.mailMode = input.mailMode;
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
    if (input.smtpPassword !== undefined) {
      data.smtpPassword = emptyToNull(input.smtpPassword);
    }
    if (input.smtpFrom !== undefined) {
      data.smtpFrom = emptyToNull(input.smtpFrom);
    }
    if (input.smtpSecure !== undefined) {
      data.smtpSecure = input.smtpSecure;
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

    const updated = await tx.platformSetting.update({
      where: { id: 1 },
      data,
    });

    await writeAuditLog(tx, actor, {
      action: "PLATFORM_SETTINGS_UPDATED",
      resourceType: "PlatformSetting",
      resourceId: "1",
      metadata: {
        mailMode: updated.mailMode,
        appUrl: updated.appUrl,
        smtpHost: updated.smtpHost,
        smtpPort: updated.smtpPort,
        smtpFrom: updated.smtpFrom,
        smtpSecure: updated.smtpSecure,
        passwordChanged: Object.prototype.hasOwnProperty.call(input, "smtpPassword"),
        attachmentMaxSizeMb: updated.attachmentMaxSizeMb,
        attachmentAllowedExtensions: updated.attachmentAllowedExtensions,
        customerReplyAttachmentsEnabled: updated.customerReplyAttachmentsEnabled,
      },
    });

    return publicSettings(updated);
  });
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
