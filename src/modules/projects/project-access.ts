import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import type { Actor } from "@/lib/actor";
import {
  canContributeToProject,
  canManageProjectDelivery,
  canViewProject,
  type ProjectAccess,
} from "@/modules/projects/permissions";
import {
  assertAllowed,
  assertFound,
  DomainError,
} from "@/modules/projects/errors";

export type CustomerProjectFeature =
  | "milestones"
  | "progress"
  | "updates"
  | "requests"
  | "files";

export async function loadProjectAccess(
  tx: Prisma.TransactionClient,
  actor: Actor,
  projectId: string,
) {
  const project = await tx.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      status: true,
      customerSpaceId: true,
      customerUpdatesEnabled: true,
      customerRequestsEnabled: true,
      customerFilesEnabled: true,
      showMilestones: true,
      showProgress: true,
      customerSpace: {
        select: {
          memberships: {
            where: { userId: actor.id },
            select: { id: true },
            take: 1,
          },
        },
      },
      staff: {
        where: { userId: actor.id },
        select: { role: true },
        take: 1,
      },
    },
  });
  assertFound(project, "项目不存在");

  const access: ProjectAccess = {
    isCustomerSpaceMember: project.customerSpace.memberships.length > 0,
    projectRole: project.staff[0]?.role ?? null,
  };

  return {
    projectId: project.id,
    projectStatus: project.status,
    customerSpaceId: project.customerSpaceId,
    customerFeatures: {
      milestones: project.showMilestones,
      progress: project.showProgress,
      updates: project.customerUpdatesEnabled,
      requests: project.customerRequestsEnabled,
      files: project.customerFilesEnabled,
    },
    access,
  };
}

export async function assertCanViewProject(
  tx: Prisma.TransactionClient,
  actor: Actor,
  projectId: string,
) {
  const context = await loadProjectAccess(tx, actor, projectId);
  assertAllowed(canViewProject(actor, context.access), "无权查看该项目");
  return context;
}

export async function assertCanViewCustomerProjectFeature(
  tx: Prisma.TransactionClient,
  actor: Actor,
  projectId: string,
  feature: CustomerProjectFeature,
) {
  const context = await assertCanViewProject(tx, actor, projectId);
  if (!actor.isStaff && !context.customerFeatures[feature]) {
    throw new DomainError("NOT_FOUND", "项目功能未开放", 404);
  }
  return context;
}

export async function assertCanManageProjectDelivery(
  tx: Prisma.TransactionClient,
  actor: Actor,
  projectId: string,
) {
  const context = await loadProjectAccess(tx, actor, projectId);
  assertAllowed(
    canManageProjectDelivery(actor, context.access),
    "仅管理员或项目负责人可以管理项目交付",
  );
  return context;
}

export async function assertCanManageActiveProjectDelivery(
  tx: Prisma.TransactionClient,
  actor: Actor,
  projectId: string,
) {
  const context = await assertCanManageProjectDelivery(tx, actor, projectId);
  if (context.projectStatus === "DRAFT") {
    throw new DomainError(
      "EXTERNAL_PROJECT_NOT_ACTIVATED",
      "请先完成外部接入并激活项目",
      409,
    );
  }
  return context;
}

export async function assertCanContributeToProject(
  tx: Prisma.TransactionClient,
  actor: Actor,
  projectId: string,
) {
  const context = await loadProjectAccess(tx, actor, projectId);
  assertAllowed(
    canContributeToProject(actor, context.access),
    "仅项目内部人员可以执行此操作",
  );
  return context;
}
