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
  // 请求边界（resolveApiActor / requireUserWithAccess）填充，供 writeAuditLog
  // 在调用点未显式传 ipAddress/userAgent 时兜底记录来源，非请求上下文为 undefined。
  ipAddress?: string | null;
  userAgent?: string | null;
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
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.user_id', ${actor.id}, true)`;
      await tx.$executeRaw`SELECT set_config('app.is_platform_admin', ${String(actor.isPlatformAdmin)}, true)`;
      await tx.$executeRaw`SELECT set_config('app.is_staff', ${String(actor.isStaff)}, true)`;
      return callback(tx);
    },
    {
      // RLS 要求整段请求工作跑在同一个 interactive 事务里，而多写路径（如回复并接手：
      // 建消息 + FOR UPDATE + 改派 + 审计）会串多次往返。Prisma 默认 5s 上限在负载
      // 高时会被撑爆并回滚（曾观测到 commit 时已耗时 7093ms），导致写操作静默丢失。
      // 这里放宽默认上限；显式传入的 options 仍然优先。
      maxWait: options?.maxWait ?? 5_000,
      timeout: options?.timeout ?? 15_000,
      isolationLevel: options?.isolationLevel,
    },
  );
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
