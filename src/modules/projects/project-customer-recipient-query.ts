import "server-only";

import type { Prisma } from "@/generated/prisma/client";

/**
 * The database function verifies project access before bypassing Membership RLS
 * and returns IDs only, never customer profile data.
 */
export async function listProjectCustomerUserIds(
  tx: Prisma.TransactionClient,
  projectId: string,
) {
  const rows = await tx.$queryRaw<Array<{ user_id: string }>>`
    SELECT user_id
    FROM app_project_customer_user_ids(${projectId})
  `;
  return rows.map((row) => row.user_id);
}
