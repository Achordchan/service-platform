import "server-only";

import type { PlatformRole, Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";

export type Actor = {
  id: string;
  name: string;
  email: string;
  platformRole: PlatformRole;
  isPlatformAdmin: boolean;
  isStaff: boolean;
};

export async function resolveActor(userId: string): Promise<Actor | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      email: true,
      platformRole: true,
    },
  });
  if (!user) return null;

  return {
    ...user,
    isPlatformAdmin: user.platformRole === "PLATFORM_ADMIN",
    isStaff: user.platformRole !== "CUSTOMER",
  };
}

export async function withActorDb<T>(
  actor: Actor,
  callback: (tx: Prisma.TransactionClient) => Promise<T>,
) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.user_id', ${actor.id}, true)`;
    await tx.$executeRaw`SELECT set_config('app.is_platform_admin', ${String(actor.isPlatformAdmin)}, true)`;
    await tx.$executeRaw`SELECT set_config('app.is_staff', ${String(actor.isStaff)}, true)`;
    return callback(tx);
  });
}

export async function withSystemDb<T>(
  callback: (tx: Prisma.TransactionClient) => Promise<T>,
) {
  const systemActor: Actor = {
    id: "system",
    name: "系统",
    email: "system@local",
    platformRole: "PLATFORM_ADMIN",
    isPlatformAdmin: true,
    isStaff: true,
  };
  return withActorDb(systemActor, callback);
}
