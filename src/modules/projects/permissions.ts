import type { ProjectStaffRole } from "@/generated/prisma/client";
import type { Actor } from "@/lib/actor";
import { hasRolePermission } from "@/modules/authorization/role-permission-policy";

export type ProjectPermissionActor = Actor;

export type ProjectAccess = {
  isCustomerSpaceMember: boolean;
  projectRole: ProjectStaffRole | null;
};

export function canViewProject(
  actor: ProjectPermissionActor,
  access: ProjectAccess,
) {
  if (actor.isPlatformAdmin) return true;
  if (actor.isStaff) {
    return (
      access.projectRole !== null && hasRolePermission(actor, "project.view")
    );
  }
  return access.isCustomerSpaceMember;
}

export function canManageProjectDelivery(
  actor: ProjectPermissionActor,
  access: ProjectAccess,
) {
  return (
    actor.isPlatformAdmin ||
    (actor.isStaff &&
      access.projectRole === "PROJECT_MANAGER" &&
      hasRolePermission(actor, "project.manage_delivery"))
  );
}

export function canManageProjectStaff(
  actor: ProjectPermissionActor,
  access: ProjectAccess,
) {
  return (
    actor.isPlatformAdmin ||
    (actor.isStaff &&
      access.projectRole === "PROJECT_MANAGER" &&
      hasRolePermission(actor, "project.manage_staff"))
  );
}

export function canPublishProjectUpdate(
  actor: ProjectPermissionActor,
  access: ProjectAccess,
) {
  return (
    actor.isPlatformAdmin ||
    (actor.isStaff &&
      access.projectRole === "PROJECT_MANAGER" &&
      hasRolePermission(actor, "update.publish"))
  );
}

export function canUploadProjectFile(
  actor: ProjectPermissionActor,
  access: ProjectAccess,
) {
  return (
    actor.isPlatformAdmin ||
    (actor.isStaff &&
      access.projectRole === "PROJECT_MANAGER" &&
      hasRolePermission(actor, "file.upload"))
  );
}

export function canContributeToProject(
  actor: ProjectPermissionActor,
  access: ProjectAccess,
) {
  return actor.isPlatformAdmin || (actor.isStaff && access.projectRole !== null);
}

export function canCommentOnProjectUpdate(
  actor: ProjectPermissionActor,
  access: ProjectAccess,
) {
  return (
    actor.isPlatformAdmin ||
    (actor.isStaff &&
      access.projectRole !== null &&
      hasRolePermission(actor, "update.comment"))
  );
}

export function canViewContent(
  actor: ProjectPermissionActor,
  access: ProjectAccess,
  visibility: "CUSTOMER_VISIBLE" | "INTERNAL",
) {
  return (
    canViewProject(actor, access) &&
    (actor.isStaff || visibility === "CUSTOMER_VISIBLE")
  );
}
