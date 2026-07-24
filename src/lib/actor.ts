import "server-only";

import type { PlatformRole, Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import {
  DEFAULT_PERMISSIONS_BY_LEVEL,
  type RolePermissionKey,
} from "@/modules/users/role-permissions";

export type Actor = {
  id: string;
  name: string;
  email: string;
  platformRole: PlatformRole;
  isPlatformAdmin: boolean;
  isStaff: boolean;
  permissions?: RolePermissionKey[];
};

export async function resolveActor(userId: string): Promise<Actor | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      email: true,
      platformRole: true,
      deletedAt: true,
      roleGroup: {
        select: {
          permissions: true,
        },
      },
    },
  });
  if (!user || user.deletedAt) return null;

  const { roleGroup } = user;
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    platformRole: user.platformRole,
    isPlatformAdmin: user.platformRole === "PLATFORM_ADMIN",
    isStaff: user.platformRole !== "CUSTOMER",
    permissions:
      user.platformRole === "PROJECT_MANAGER" ||
      user.platformRole === "TECHNICIAN"
        ? ((roleGroup?.permissions ??
            DEFAULT_PERMISSIONS_BY_LEVEL[
              user.platformRole
            ]) as RolePermissionKey[])
        : [],
  };
}

export async function withActorDb<T>(
  actor: Actor,
  callback: (tx: Prisma.TransactionClient) => Promise<T>,
  options?: {
    maxWait?: number;
    timeout?: number;
    isolationLevel?: Prisma.TransactionIsolationLevel;
  },
) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.user_id', ${actor.id}, true)`;
    await tx.$executeRaw`SELECT set_config('app.is_platform_admin', ${String(actor.isPlatformAdmin)}, true)`;
    await tx.$executeRaw`SELECT set_config('app.is_staff', ${String(actor.isStaff)}, true)`;
    return callback(tx);
  }, options);
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
    permissions: [],
  };
  return withActorDb(systemActor, callback);
}
