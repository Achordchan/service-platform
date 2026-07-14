import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma-client";

export async function withSystemDb<T>(
  callback: (tx: Prisma.TransactionClient) => Promise<T>,
) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.user_id', 'system', true)`;
    await tx.$executeRaw`SELECT set_config('app.is_platform_admin', 'true', true)`;
    await tx.$executeRaw`SELECT set_config('app.is_staff', 'true', true)`;
    return callback(tx);
  });
}
