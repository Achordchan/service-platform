import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { withSystemDb } from "@/lib/system-db";
import {
  configsMatch,
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
                  healthStatus: "UNKNOWN" as const,
                  lastCheckedAt: null,
                  lastError: null,
                }
              : {}),
            ...(configChanged
              ? { config: parsed.config as Prisma.InputJsonValue }
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
