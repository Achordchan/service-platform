import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { withSystemDb } from "@/lib/system-db";
import { listRegisteredPlugins } from "@/modules/plugins/plugin-registry";

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
        select: { version: true },
      });
      if (installation.version !== manifest.version) {
        await tx.pluginInstallation.update({
          where: { key: manifest.key },
          data: {
            version: manifest.version,
            enabled: false,
            healthStatus: "UNKNOWN",
            lastCheckedAt: null,
            lastError: null,
          },
        });
        await tx.pluginRun.updateMany({
          where: {
            pluginKey: manifest.key,
            status: { in: ["QUEUED", "RUNNING"] },
          },
          data: { status: "PAUSED" },
        });
      }
    }
  });
}
