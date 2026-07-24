import type { PlatformRole } from "@/generated/prisma/client";
import {
  DEFAULT_PERMISSIONS_BY_LEVEL,
  type RolePermissionKey,
} from "@/modules/users/role-permissions";

export type RolePermissionActor = {
  platformRole: PlatformRole;
  isPlatformAdmin: boolean;
  isStaff: boolean;
  permissions?: RolePermissionKey[];
};

export function hasRolePermission(
  actor: RolePermissionActor,
  permission: RolePermissionKey,
) {
  if (actor.isPlatformAdmin) return true;
  if (!actor.isStaff) return false;

  const permissions =
    actor.permissions ??
    (actor.platformRole === "PROJECT_MANAGER" ||
    actor.platformRole === "TECHNICIAN"
      ? DEFAULT_PERMISSIONS_BY_LEVEL[actor.platformRole]
      : []);
  return permissions.includes(permission);
}
