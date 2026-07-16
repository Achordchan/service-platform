import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { withSystemDb } from "@/lib/system-db";
import { listRegisteredPlugins } from "@/modules/plugins/plugin-registry";

export async function ensurePluginInstallations() {
  const manifests = listRegisteredPlugins();
  await withSystemDb(async (tx) => {
    for (const manifest of manifests) {
      await tx.pluginInstallation.upsert({
        where: { key: manifest.key },
        create: {
          key: manifest.key,
          version: manifest.version,
          enabled: false,
          config: manifest.defaultConfig as Prisma.InputJsonValue,
        },
        update: {
          version: manifest.version,
        },
      });
    }
  });
}
