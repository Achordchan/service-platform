import type { ProjectStaffRole } from "@/generated/prisma/client";
import type { Actor } from "@/lib/actor";
import { hasRolePermission } from "@/modules/authorization/role-permission-policy";

export type RequestAccessContext = {
  assigneeId: string | null;
  assigneeIds?: string[];
  projectRole: ProjectStaffRole | null;
};

export function canViewProjectRequests(actor: Actor, projectRole: ProjectStaffRole | null) {
  if (actor.isPlatformAdmin) return true;
  return (
    actor.isStaff &&
    projectRole !== null &&
    (hasRolePermission(actor, "request.view_project") ||
      hasRolePermission(actor, "request.view_assigned"))
  );
}

export function canViewRequest(
  actor: Actor,
  context: RequestAccessContext,
) {
  if (actor.isPlatformAdmin) return true;
  if (!actor.isStaff || context.projectRole === null) return false;
  if (hasRolePermission(actor, "request.view_project")) return true;
  if (!hasRolePermission(actor, "request.view_assigned")) return false;

  const assignedToActor =
    context.assigneeId === actor.id ||
    (context.assigneeIds?.includes(actor.id) ?? false);
  const unassigned =
    !context.assigneeId && (context.assigneeIds?.length ?? 0) === 0;
  return assignedToActor || unassigned;
}

export function canManageRequestAssignment(
  actor: Actor,
  context: RequestAccessContext,
) {
  return (
    actor.isPlatformAdmin ||
    (context.projectRole === "PROJECT_MANAGER" &&
      hasRolePermission(actor, "request.assign"))
  );
}

export function canWorkOnRequest(
  actor: Actor,
  context: RequestAccessContext,
) {
  const isAssigned =
    context.assigneeId === actor.id ||
    (context.assigneeIds?.includes(actor.id) ?? false);
  return (
    actor.isPlatformAdmin ||
    context.projectRole === "PROJECT_MANAGER" ||
    (actor.isStaff && isAssigned)
  );
}

export function canWriteInternalNote(
  actor: Actor,
  context: RequestAccessContext,
) {
  return (
    actor.isStaff &&
    canWorkOnRequest(actor, context) &&
    hasRolePermission(actor, "request.reply")
  );
}

export function canReplyToRequest(
  actor: Actor,
  context: RequestAccessContext,
) {
  return (
    actor.isStaff &&
    canWorkOnRequest(actor, context) &&
    hasRolePermission(actor, "request.reply")
  );
}

export function canClaimUnassignedRequest(
  actor: Actor,
  context: RequestAccessContext,
) {
  const hasAssignee = Boolean(
    context.assigneeId || (context.assigneeIds?.length ?? 0) > 0,
  );
  return (
    actor.isStaff &&
    context.projectRole !== null &&
    !hasAssignee &&
    hasRolePermission(actor, "request.reply")
  );
}

export function canChangeRequestStatus(
  actor: Actor,
  context: RequestAccessContext,
) {
  return (
    actor.isStaff &&
    canWorkOnRequest(actor, context) &&
    hasRolePermission(actor, "request.change_status")
  );
}

export function canUploadRequestFile(
  actor: Actor,
  context: RequestAccessContext,
) {
  return (
    actor.isStaff &&
    canWorkOnRequest(actor, context) &&
    hasRolePermission(actor, "file.upload")
  );
}

export function canManageRequestArchive(
  actor: Actor,
  context: RequestAccessContext,
) {
  return canChangeRequestStatus(actor, context);
}

export function canConfirmRequestClosed(actor: Actor) {
  return actor.platformRole === "CUSTOMER";
}

export function canAttachToRequestMessage(
  actor: Actor,
  message: { authorId: string | null },
) {
  return message.authorId === actor.id;
}
