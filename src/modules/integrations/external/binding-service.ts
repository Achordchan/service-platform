import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { DomainError } from "@/modules/projects/errors";

export const PRIMARY_EXTERNAL_CONNECTOR_SLOT = "PRIMARY";

export async function lockExternalConnectorSlot(
  tx: Prisma.TransactionClient,
  projectId: string,
  pluginKey: string,
) {
  await tx.$executeRaw`
    SELECT pg_advisory_xact_lock(
      hashtextextended(${`external-connector:${projectId}`}, 0)
    )
  `;
  const conflictingBinding = await tx.projectPluginBinding.findFirst({
    where: {
      projectId,
      externalConnectorSlot: PRIMARY_EXTERNAL_CONNECTOR_SLOT,
      pluginKey: { not: pluginKey },
    },
    select: { pluginKey: true },
  });
  if (conflictingBinding) {
    throw new DomainError(
      "EXTERNAL_CONNECTOR_CONFLICT",
      "一个外部接入项目只能绑定一个连接器",
      409,
      { existingPluginKey: conflictingBinding.pluginKey },
    );
  }
}
