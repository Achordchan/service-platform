import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma-client";

export type ExternalActor = {
  id: string;
  bindingId: string;
  externalUserId: string;
  name: string;
  email: string | null;
  username: string | null;
  projectId: string;
  customerSpaceId: string;
};

export async function withExternalActorDb<T>(
  actor: ExternalActor,
  callback: (tx: Prisma.TransactionClient) => Promise<T>,
) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.user_id', '', true)`;
    await tx.$executeRaw`SELECT set_config('app.is_platform_admin', 'false', true)`;
    await tx.$executeRaw`SELECT set_config('app.is_staff', 'false', true)`;
    await tx.$executeRaw`SELECT set_config('app.external_contact_id', ${actor.id}, true)`;
    return callback(tx);
  });
}
