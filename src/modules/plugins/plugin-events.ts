import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { publishEvent } from "@/modules/notifications/notification-service";

export function publishPluginRunEvent(
  tx: Prisma.TransactionClient,
  runId: string,
  pluginKey: string,
  status: string,
) {
  return publishEvent(tx, {
    type: "PLUGIN_RUN_UPDATED",
    payload: {
      pluginKey,
      runId,
      status,
    },
  });
}
