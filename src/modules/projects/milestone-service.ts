import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import type { Actor } from "@/lib/actor";
import { withActorDb } from "@/lib/actor";
import { writeAuditLog } from "@/modules/audit/audit-service";
import { publishProjectChange } from "@/modules/notifications/notification-service";
import {
  assertCanManageProjectDelivery,
  assertCanViewProject,
} from "@/modules/projects/project-access";
import { assertFound, DomainError } from "@/modules/projects/errors";
import { calculateProjectProgress } from "@/modules/projects/progress";
import type {
  CreateMilestoneInput,
  UpdateMilestoneInput,
} from "@/modules/projects/schemas";

function auditMetadata(value: unknown) {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

export function listMilestones(actor: Actor, projectId: string) {
  return withActorDb(actor, async (tx) => {
    await assertCanViewProject(tx, actor, projectId);
    const milestones = await tx.milestone.findMany({
      where: { projectId },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    });
    return {
      milestones,
      progress: calculateProjectProgress(milestones),
    };
  });
}

export function getProjectProgress(actor: Actor, projectId: string) {
  return withActorDb(actor, async (tx) => {
    await assertCanViewProject(tx, actor, projectId);
    const milestones = await tx.milestone.findMany({
      where: { projectId },
      select: {
        id: true,
        title: true,
        status: true,
        sortOrder: true,
        startDate: true,
        endDate: true,
      },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    });
    return {
      ...calculateProjectProgress(milestones),
      milestones,
    };
  });
}

export function createMilestone(
  actor: Actor,
  projectId: string,
  input: CreateMilestoneInput,
) {
  return withActorDb(actor, async (tx) => {
    const context = await assertCanManageProjectDelivery(tx, actor, projectId);
    const milestone = await tx.milestone.create({
      data: {
        ...input,
        projectId,
        createdById: actor.id,
      },
    });
    await writeAuditLog(tx, actor, {
      action: "MILESTONE_CREATED",
      resourceType: "Milestone",
      resourceId: milestone.id,
      customerSpaceId: context.customerSpaceId,
      projectId,
      metadata: auditMetadata(input),
    });
    await publishProjectChange(tx, actor, {
      change: "MILESTONE_CREATED",
      customerSpaceId: context.customerSpaceId,
      projectId,
      payload: { milestoneId: milestone.id },
    });
    return milestone;
  });
}

export function updateMilestone(
  actor: Actor,
  projectId: string,
  milestoneId: string,
  input: UpdateMilestoneInput,
) {
  return withActorDb(actor, async (tx) => {
    const context = await assertCanManageProjectDelivery(tx, actor, projectId);
    const existing = await tx.milestone.findFirst({
      where: { id: milestoneId, projectId },
      select: { id: true, startDate: true, endDate: true },
    });
    assertFound(existing, "里程碑不存在");

    const startDate =
      input.startDate === undefined
        ? existing.startDate
        : input.startDate
          ? new Date(input.startDate)
          : null;
    const endDate =
      input.endDate === undefined
        ? existing.endDate
        : input.endDate
          ? new Date(input.endDate)
          : null;
    if (startDate && endDate && endDate < startDate) {
      throw new DomainError(
        "INVALID_DATE_RANGE",
        "结束日期不能早于开始日期",
        422,
      );
    }

    const milestone = await tx.milestone.update({
      where: { id: milestoneId },
      data: input,
    });
    await writeAuditLog(tx, actor, {
      action: "MILESTONE_UPDATED",
      resourceType: "Milestone",
      resourceId: milestone.id,
      customerSpaceId: context.customerSpaceId,
      projectId,
      metadata: auditMetadata(input),
    });
    await publishProjectChange(tx, actor, {
      change: "MILESTONE_UPDATED",
      customerSpaceId: context.customerSpaceId,
      projectId,
      payload: { milestoneId: milestone.id },
    });
    return milestone;
  });
}

export function deleteMilestone(
  actor: Actor,
  projectId: string,
  milestoneId: string,
) {
  return withActorDb(actor, async (tx) => {
    const context = await assertCanManageProjectDelivery(tx, actor, projectId);
    const existing = await tx.milestone.findFirst({
      where: { id: milestoneId, projectId },
      select: { id: true, title: true },
    });
    assertFound(existing, "里程碑不存在");

    await tx.milestone.delete({ where: { id: milestoneId } });
    await writeAuditLog(tx, actor, {
      action: "MILESTONE_DELETED",
      resourceType: "Milestone",
      resourceId: milestoneId,
      customerSpaceId: context.customerSpaceId,
      projectId,
      metadata: { title: existing.title },
    });
    await publishProjectChange(tx, actor, {
      change: "MILESTONE_DELETED",
      customerSpaceId: context.customerSpaceId,
      projectId,
      payload: { milestoneId },
    });
  });
}
