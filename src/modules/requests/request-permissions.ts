import type { ProjectStaffRole } from "@/generated/prisma/client";
import type { Actor } from "@/lib/actor";

export type RequestAccessContext = {
  assigneeId: string | null;
  assigneeIds?: string[];
  projectRole: ProjectStaffRole | null;
};

export function canManageRequestAssignment(
  actor: Actor,
  context: RequestAccessContext,
) {
  return (
    actor.isPlatformAdmin || context.projectRole === "PROJECT_MANAGER"
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
  return actor.isStaff && canWorkOnRequest(actor, context);
}

export function canManageRequestArchive(
  actor: Actor,
  context: RequestAccessContext,
) {
  return actor.isStaff && canWorkOnRequest(actor, context);
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
