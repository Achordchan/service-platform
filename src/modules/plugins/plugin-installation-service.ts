import "server-only";

import { randomUUID } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { withSystemDb } from "@/lib/system-db";
import {
  configsMatch,
  CONTENT_CONTACT_RISK_PLUGIN_KEY,
  DINGTALK_ROBOT_PLUGIN_KEY,
  listRegisteredPlugins,
  tryParseRegisteredPluginConfig,
} from "@/modules/plugins/plugin-registry";

/** Pause active runs and revoke embed sessions. Safe to call repeatedly. */
export async function applyPluginDisableSideEffects(
  tx: Prisma.TransactionClient,
  pluginKey: string,
) {
  const now = new Date();
  await tx.pluginRun.updateMany({
    where: {
      pluginKey,
      status: { in: ["QUEUED", "RUNNING"] },
    },
    data: { status: "PAUSED" },
  });
  await tx.externalEmbedSession.updateMany({
    where: {
      binding: { pluginKey },
      revokedAt: null,
    },
    data: { revokedAt: now },
  });
  await tx.universalLaunchTicket.updateMany({
    where: {
      connection: { binding: { pluginKey } },
      consumedAt: null,
      expiresAt: { gt: now },
    },
    data: { expiresAt: now },
  });
  if (pluginKey === DINGTALK_ROBOT_PLUGIN_KEY) {
    await tx.dingTalkRobotDelivery.updateMany({
      where: { status: { in: ["PENDING", "HELD", "PROCESSING"] } },
      data: {
        status: "SKIPPED",
        nextAttemptAt: null,
        lastError: "插件已停用",
      },
    });
  }
  if (pluginKey === CONTENT_CONTACT_RISK_PLUGIN_KEY) {
    await tx.contentRiskRuntimeState.updateMany({
      where: { pluginKey },
      data: { bypassedAt: now },
    });
    const reviews = await tx.contentRiskReview.findMany({
      where: { status: { in: ["QUEUED", "PROCESSING"] } },
      select: { id: true },
    });
    const reviewIds = reviews.map((review) => review.id);
    if (reviewIds.length > 0) {
      const [mailNotification, heldMail, dingTalkDeliveries] = await Promise.all([
        tx.notification.findFirst({
          where: {
            contentRiskReviewId: { in: reviewIds },
            contentRiskEmailDueAt: { not: null },
            readAt: null,
          },
          select: { id: true },
        }),
        tx.mailMessage.findFirst({
          where: {
            contentRiskReviewId: { in: reviewIds },
            status: "QUEUED",
          },
          select: { id: true },
        }),
        tx.dingTalkRobotDelivery.findMany({
          where: {
            contentRiskReviewId: { in: reviewIds },
            status: "HELD",
          },
          select: { id: true },
        }),
      ]);
      await tx.contentRiskReview.updateMany({
        where: { id: { in: reviewIds } },
        data: {
          status: "CANCELLED",
          completedAt: now,
          nextAttemptAt: null,
          lastError: "插件已停用或进入异常旁路",
        },
      });
      await tx.$executeRaw`
        UPDATE "Notification"
        SET "emailDueAt" = "contentRiskEmailDueAt",
            "contentRiskEmailDueAt" = NULL,
            "contentRiskReviewId" = NULL,
            "emailClaimedAt" = NULL,
            "readAt" = CASE
              WHEN "contentRiskSuppressed" = TRUE
                THEN "contentRiskReadAtBeforeSuppression"
              ELSE "readAt"
            END,
            body = CASE
              WHEN "contentRiskSuppressed" = TRUE
                THEN COALESCE("contentRiskBodyBeforeSuppression", body)
              ELSE body
            END,
            "contentRiskReadAtBeforeSuppression" = NULL,
            "contentRiskBodyBeforeSuppression" = NULL,
            "contentRiskSuppressed" = FALSE
        WHERE "contentRiskReviewId" = ANY(${reviewIds}::text[])
      `;
      await tx.dingTalkRobotDelivery.updateMany({
        where: {
          contentRiskReviewId: { in: reviewIds },
          status: "HELD",
        },
        data: {
          contentRiskReviewId: null,
          status: "PENDING",
          nextAttemptAt: now,
          lastError: null,
        },
      });
      await tx.mailMessage.updateMany({
        where: {
          contentRiskReviewId: { in: reviewIds },
          status: "QUEUED",
        },
        data: {
          contentRiskReviewId: null,
          status: "QUEUED",
          lastAttemptAt: null,
          errorMessage: null,
        },
      });
      if (mailNotification) {
        await tx.$executeRaw`
          SELECT pg_notify('service_platform_mail_outbox', ${mailNotification.id})
        `;
      }
      if (heldMail) {
        await tx.$executeRaw`
          SELECT pg_notify('service_platform_mail_outbox', ${heldMail.id})
        `;
      }
      for (const delivery of dingTalkDeliveries) {
        await tx.$executeRaw`
          SELECT pg_notify('service_platform_dingtalk_deliveries', ${delivery.id})
        `;
      }
    }
  }
}

export async function applyPluginEnableSideEffects(
  tx: Prisma.TransactionClient,
  pluginKey: string,
) {
  if (pluginKey !== CONTENT_CONTACT_RISK_PLUGIN_KEY) return;
  const now = new Date();
  await tx.contentRiskRuntimeState.upsert({
    where: { pluginKey },
    create: {
      pluginKey,
      activationId: randomUUID(),
      enabledAt: now,
      bypassedAt: null,
    },
    update: {
      activationId: randomUUID(),
      enabledAt: now,
      bypassedAt: null,
      unsupportedNotified: Prisma.JsonNull,
    },
  });
}

export async function ensurePluginInstallations() {
  const manifests = listRegisteredPlugins();
  await withSystemDb(async (tx) => {
    for (const manifest of manifests) {
      const installation = await tx.pluginInstallation.upsert({
        where: { key: manifest.key },
        create: {
          key: manifest.key,
          version: manifest.version,
          enabled: false,
          config: manifest.defaultConfig as Prisma.InputJsonValue,
        },
        update: {},
        select: {
          version: true,
          config: true,
          enabled: true,
          healthStatus: true,
          lastError: true,
        },
      });
      const versionChanged = installation.version !== manifest.version;
      const parsed = tryParseRegisteredPluginConfig(
        manifest.key,
        installation.config,
      );

      if (!parsed.ok) {
        const nextError = `配置无效：${parsed.error}`;
        const needsInvalidState =
          versionChanged ||
          installation.healthStatus !== "ERROR" ||
          installation.lastError !== nextError ||
          installation.enabled;
        if (needsInvalidState) {
          await tx.pluginInstallation.update({
            where: { key: manifest.key },
            data: {
              ...(versionChanged
                ? {
                    version: manifest.version,
                    lastCheckedAt: null,
                  }
                : {}),
              enabled: false,
              healthConfigFingerprint: null,
              healthStatus: "ERROR",
              lastError: nextError,
            },
          });
        }
        // Always enforce full disable semantics for invalid config, including
        // same-version re-entry, so stale embed tokens cannot revive later.
        await applyPluginDisableSideEffects(tx, manifest.key);
        continue;
      }

      const configChanged = !configsMatch(
        installation.config,
        parsed.config,
      );
      if (versionChanged || configChanged) {
        await tx.pluginInstallation.update({
          where: { key: manifest.key },
          data: {
            ...(versionChanged
              ? {
                  version: manifest.version,
                  enabled: false,
                  healthConfigFingerprint: null,
                  healthStatus: "UNKNOWN" as const,
                  lastCheckedAt: null,
                  lastError: null,
                }
              : {}),
            ...(configChanged
              ? {
                  config: parsed.config as Prisma.InputJsonValue,
                }
              : {}),
          },
        });
        if (versionChanged) {
          await applyPluginDisableSideEffects(tx, manifest.key);
        }
      }
    }
  });
}
