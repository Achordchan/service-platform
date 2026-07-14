import "server-only";

import type {
  ContentVisibility,
  ProjectStaffRole,
  SpaceMemberRole,
} from "@/generated/prisma/client";
import type { Actor } from "@/lib/actor";

export function assertPlatformAdmin(actor: Actor) {
  if (!actor.isPlatformAdmin) {
    throw new Error("FORBIDDEN");
  }
}

export function assertStaff(actor: Actor) {
  if (!actor.isStaff) {
    throw new Error("FORBIDDEN");
  }
}

export function assertCanCreateInternalContent(actor: Actor) {
  assertStaff(actor);
}

export function normalizeVisibility(
  actor: Actor,
  requested: ContentVisibility,
) {
  if (requested === "INTERNAL") {
    assertCanCreateInternalContent(actor);
  }
  return requested;
}

export function canManageMembers(role: SpaceMemberRole | null) {
  return role === "OWNER";
}

export function canManageProject(
  actor: Actor,
  projectRole: ProjectStaffRole | null,
) {
  return actor.isPlatformAdmin || projectRole === "PROJECT_MANAGER";
}
