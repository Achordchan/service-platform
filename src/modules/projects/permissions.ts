import type { ProjectStaffRole } from "@/generated/prisma/client";

export type ProjectPermissionActor = {
  id: string;
  isPlatformAdmin: boolean;
  isStaff: boolean;
};

export type ProjectAccess = {
  isCustomerSpaceMember: boolean;
  projectRole: ProjectStaffRole | null;
};

export function canViewProject(
  actor: ProjectPermissionActor,
  access: ProjectAccess,
) {
  if (actor.isPlatformAdmin) return true;
  if (actor.isStaff) return access.projectRole !== null;
  return access.isCustomerSpaceMember;
}

export function canManageProjectDelivery(
  actor: ProjectPermissionActor,
  access: ProjectAccess,
) {
  return (
    actor.isPlatformAdmin ||
    (actor.isStaff && access.projectRole === "PROJECT_MANAGER")
  );
}

export function canContributeToProject(
  actor: ProjectPermissionActor,
  access: ProjectAccess,
) {
  return actor.isPlatformAdmin || (actor.isStaff && access.projectRole !== null);
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
