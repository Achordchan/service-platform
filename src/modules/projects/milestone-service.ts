import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import type { Actor } from "@/lib/actor";
import { withActorDb } from "@/lib/actor";
import {
  extractInlineAttachmentIds,
  hasMeaningfulHtml,
} from "@/lib/message-content";
import { sanitizeMessageHtml } from "@/lib/sanitize-html";
import { claimUserInlineAttachments } from "@/modules/attachments/inline-attachment-service";
import { removePrivateFile } from "@/modules/attachments/private-storage";
import { writeAuditLog } from "@/modules/audit/audit-service";
import { dispatchProjectActivity } from "@/modules/notifications/notification-service";
import {
  assertCanManageProjectDelivery,
  assertCanViewCustomerProjectFeature,
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

function sanitizeMilestoneDescription(description?: string | null) {
  if (!description) return null;
  const sanitized = sanitizeMessageHtml(description);
  return hasMeaningfulHtml(sanitized) ? sanitized : null;
}

export function listMilestones(actor: Actor, projectId: string) {
  return withActorDb(actor, async (tx) => {
    await assertCanViewCustomerProjectFeature(
      tx,
      actor,
      projectId,
      "milestones",
    );
    const milestones = await tx.milestone.findMany({
      where: { projectId },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    });
    return {
      milestones: milestones.map((milestone) => ({
        ...milestone,
        description: milestone.description
          ? sanitizeMessageHtml(milestone.description)
          : null,
      })),
      progress: calculateProjectProgress(milestones),
    };
  });
}

export function getProjectProgress(actor: Actor, projectId: string) {
  return withActorDb(actor, async (tx) => {
    const context = await assertCanViewCustomerProjectFeature(
      tx,
      actor,
      projectId,
      "progress",
    );
    if (!actor.isStaff && !context.customerFeatures.milestones) {
      const [progress] = await tx.$queryRaw<
        Array<{
          total: number;
          not_started: number;
          in_progress: number;
          completed: number;
          percentage: number;
        }>
      >`SELECT * FROM app_project_milestone_progress(${projectId})`;
      return {
        percentage: progress?.percentage ?? 0,
        counts: {
          total: progress?.total ?? 0,
          notStarted: progress?.not_started ?? 0,
          inProgress: progress?.in_progress ?? 0,
          completed: progress?.completed ?? 0,
        },
        milestones: [],
      };
    }
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
    const description = sanitizeMilestoneDescription(input.description);
    const milestone = await tx.milestone.create({
      data: {
        ...input,
        description,
        projectId,
        createdById: actor.id,
      },
    });
    await claimUserInlineAttachments(
      tx,
      actor,
      extractInlineAttachmentIds(description ?? ""),
      {
        projectId,
        milestoneId: milestone.id,
        visibility: "CUSTOMER_VISIBLE",
      },
    );
    await writeAuditLog(tx, actor, {
      action: "MILESTONE_CREATED",
      resourceType: "Milestone",
      resourceId: milestone.id,
      customerSpaceId: context.customerSpaceId,
      projectId,
      metadata: auditMetadata({ ...input, description }),
    });
    await dispatchProjectActivity(tx, actor, {
      eventType: "PROJECT_UPDATED",
      eventPayload: {
        change: "MILESTONE_CREATED",
        actorId: actor.id,
        projectId,
        milestoneId: milestone.id,
      },
      notificationType: "PROJECT_MILESTONE",
      notificationTitle: "项目新增里程碑",
      notificationBody: milestone.title,
      visibility:
        context.customerFeatures.milestones || context.customerFeatures.progress
          ? "CUSTOMER_VISIBLE"
          : "INTERNAL",
      customerSpaceId: context.customerSpaceId,
      projectId,
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
      select: {
        id: true,
        startDate: true,
        endDate: true,
        attachments: {
          where: { inline: true },
          select: { id: true, storageKey: true },
        },
      },
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

    const description =
      input.description === undefined
        ? undefined
        : sanitizeMilestoneDescription(input.description);
    const updateInput = {
      ...input,
      ...(input.description === undefined ? {} : { description }),
    };
    const milestone = await tx.milestone.update({
      where: { id: milestoneId },
      data: updateInput,
    });
    const removedStorageKeys: string[] = [];
    if (description !== undefined) {
      const nextAttachmentIds = new Set(
        extractInlineAttachmentIds(description ?? ""),
      );
      const existingAttachmentIds = new Set(
        existing.attachments.map((attachment) => attachment.id),
      );
      const newAttachmentIds = Array.from(nextAttachmentIds).filter(
        (id) => !existingAttachmentIds.has(id),
      );
      await claimUserInlineAttachments(tx, actor, newAttachmentIds, {
        projectId,
        milestoneId,
        visibility: "CUSTOMER_VISIBLE",
      });
      const removedAttachments = existing.attachments.filter(
        (attachment) => !nextAttachmentIds.has(attachment.id),
      );
      if (removedAttachments.length > 0) {
        await tx.attachment.deleteMany({
          where: { id: { in: removedAttachments.map((item) => item.id) } },
        });
        removedStorageKeys.push(
          ...removedAttachments.map((attachment) => attachment.storageKey),
        );
      }
    }
    await writeAuditLog(tx, actor, {
      action: "MILESTONE_UPDATED",
      resourceType: "Milestone",
      resourceId: milestone.id,
      customerSpaceId: context.customerSpaceId,
      projectId,
      metadata: auditMetadata(updateInput),
    });
    await dispatchProjectActivity(tx, actor, {
      eventType: "PROJECT_UPDATED",
      eventPayload: {
        change: "MILESTONE_UPDATED",
        actorId: actor.id,
        projectId,
        milestoneId: milestone.id,
      },
      notificationType: "PROJECT_MILESTONE",
      notificationTitle: "项目里程碑已更新",
      notificationBody: milestone.title,
      visibility:
        context.customerFeatures.milestones || context.customerFeatures.progress
          ? "CUSTOMER_VISIBLE"
          : "INTERNAL",
      customerSpaceId: context.customerSpaceId,
      projectId,
    });
    return { milestone, removedStorageKeys };
  }).then(async ({ milestone, removedStorageKeys }) => {
    await removeMilestoneFiles(milestone.id, removedStorageKeys);
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
      select: {
        id: true,
        title: true,
        attachments: { select: { storageKey: true } },
      },
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
    await dispatchProjectActivity(tx, actor, {
      eventType: "PROJECT_UPDATED",
      eventPayload: {
        change: "MILESTONE_DELETED",
        actorId: actor.id,
        projectId,
        milestoneId,
      },
      notificationType: "PROJECT_MILESTONE",
      notificationTitle: "项目里程碑已删除",
      notificationBody: existing.title,
      visibility:
        context.customerFeatures.milestones || context.customerFeatures.progress
          ? "CUSTOMER_VISIBLE"
          : "INTERNAL",
      customerSpaceId: context.customerSpaceId,
      projectId,
    });
    return existing.attachments.map((attachment) => attachment.storageKey);
  }).then((storageKeys) => removeMilestoneFiles(milestoneId, storageKeys));
}

async function removeMilestoneFiles(
  milestoneId: string,
  storageKeys: string[],
) {
  let failedCount = 0;
  for (const storageKey of storageKeys) {
    try {
      await removePrivateFile(storageKey);
    } catch {
      failedCount += 1;
    }
  }
  if (failedCount > 0) {
    console.error("MILESTONE_ATTACHMENT_FILE_DELETE_FAILED", {
      milestoneId,
      failedCount,
    });
  }
}
