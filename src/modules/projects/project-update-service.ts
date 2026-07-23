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
import {
  dispatchProjectActivity,
  publishProjectChange,
} from "@/modules/notifications/notification-service";
import {
  assertCanManageActiveProjectDelivery,
  assertCanViewCustomerProjectFeature,
} from "@/modules/projects/project-access";
import {
  assertAllowed,
  assertFound,
  DomainError,
} from "@/modules/projects/errors";
import { canViewContent } from "@/modules/projects/permissions";
import type {
  CreateProjectUpdateInput,
  CreateUpdateCommentInput,
  UpdateProjectUpdateInput,
  UpdateUpdateCommentInput,
} from "@/modules/projects/schemas";

function auditMetadata(value: unknown) {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function sanitizeProjectUpdateBody(body: string) {
  const sanitized = sanitizeMessageHtml(body);
  if (!hasMeaningfulHtml(sanitized)) {
    throw new DomainError("EMPTY_PROJECT_UPDATE", "请填写进度说明", 422);
  }
  if (sanitized.length > 20_000) {
    throw new DomainError("PROJECT_UPDATE_TOO_LONG", "进度说明过长", 422);
  }
  return sanitized;
}

export function listProjectUpdates(actor: Actor, projectId: string) {
  return withActorDb(actor, async (tx) => {
    await assertCanViewCustomerProjectFeature(
      tx,
      actor,
      projectId,
      "updates",
    );
    const updates = await tx.projectUpdate.findMany({
      where: {
        projectId,
        visibility: actor.isStaff ? undefined : "CUSTOMER_VISIBLE",
      },
      include: {
        author: {
          select: { id: true, name: true },
        },
        comments: {
          where: {
            visibility: actor.isStaff ? undefined : "CUSTOMER_VISIBLE",
          },
          include: {
            author: {
              select: { id: true, name: true },
            },
          },
          orderBy: { createdAt: "asc" },
        },
      },
      orderBy: { createdAt: "desc" },
    });
    return updates.map((update) => ({
      ...update,
      body: sanitizeMessageHtml(update.body),
    }));
  });
}

export function createProjectUpdate(
  actor: Actor,
  projectId: string,
  input: CreateProjectUpdateInput,
) {
  return withActorDb(actor, async (tx) => {
    const context = await assertCanManageActiveProjectDelivery(
      tx,
      actor,
      projectId,
    );
    const body = sanitizeProjectUpdateBody(input.body);
    const update = await tx.projectUpdate.create({
      data: {
        title: input.title,
        body,
        visibility: input.visibility ?? "CUSTOMER_VISIBLE",
        projectId,
        authorId: actor.id,
      },
      include: {
        author: {
          select: { id: true, name: true },
        },
      },
    });
    await claimUserInlineAttachments(
      tx,
      actor,
      extractInlineAttachmentIds(body),
      {
        projectId,
        projectUpdateId: update.id,
        visibility: update.visibility,
      },
    );
    await writeAuditLog(tx, actor, {
      action: "PROJECT_UPDATE_CREATED",
      resourceType: "ProjectUpdate",
      resourceId: update.id,
      customerSpaceId: context.customerSpaceId,
      projectId,
      metadata: {
        title: update.title,
        visibility: update.visibility,
      },
    });
    await dispatchProjectActivity(tx, actor, {
      eventType: "PROJECT_UPDATE_CREATED",
      eventPayload: {
        projectId,
        projectUpdateId: update.id,
        actorId: actor.id,
      },
      notificationType: "PROJECT_UPDATE",
      notificationTitle: "项目进度已更新",
      notificationBody: "项目发布了新的进度动态。",
      visibility: update.visibility,
      customerSpaceId: context.customerSpaceId,
      projectId,
    });
    return update;
  });
}

export function updateProjectUpdate(
  actor: Actor,
  projectId: string,
  projectUpdateId: string,
  input: UpdateProjectUpdateInput,
) {
  return withActorDb(actor, async (tx) => {
    const context = await assertCanManageActiveProjectDelivery(
      tx,
      actor,
      projectId,
    );
    const existing = await tx.projectUpdate.findFirst({
      where: { id: projectUpdateId, projectId },
      select: {
        id: true,
        body: true,
        visibility: true,
        attachments: {
          select: { id: true, storageKey: true, inline: true },
        },
      },
    });
    assertFound(existing, "进度动态不存在");

    const updateInput = {
      ...input,
      ...(input.body === undefined
        ? {}
        : { body: sanitizeProjectUpdateBody(input.body) }),
    };
    const update = await tx.projectUpdate.update({
      where: { id: projectUpdateId },
      data: updateInput,
      include: {
        author: {
          select: { id: true, name: true },
        },
      },
    });
    const removedStorageKeys: string[] = [];
    const finalBody = update.body;
    const finalVisibility = update.visibility;
    const nextAttachmentIds = new Set(extractInlineAttachmentIds(finalBody));
    const existingInlineAttachments = existing.attachments.filter(
      (attachment) => attachment.inline,
    );
    const existingAttachmentIds = new Set(
      existingInlineAttachments.map((attachment) => attachment.id),
    );
    const newAttachmentIds = Array.from(nextAttachmentIds).filter(
      (id) => !existingAttachmentIds.has(id),
    );
    await claimUserInlineAttachments(tx, actor, newAttachmentIds, {
      projectId,
      projectUpdateId: update.id,
      visibility: finalVisibility,
    });
    await tx.attachment.updateMany({
      where: { projectUpdateId: update.id },
      data: { visibility: finalVisibility },
    });
    const removedAttachments = existingInlineAttachments.filter(
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
    await writeAuditLog(tx, actor, {
      action: "PROJECT_UPDATE_UPDATED",
      resourceType: "ProjectUpdate",
      resourceId: update.id,
      customerSpaceId: context.customerSpaceId,
      projectId,
      metadata: auditMetadata(updateInput),
    });
    await publishProjectChange(tx, actor, {
      change: "PROJECT_UPDATE_UPDATED",
      customerSpaceId: context.customerSpaceId,
      projectId,
      visibility: update.visibility,
      payload: { projectUpdateId: update.id },
    });
    return { update, removedStorageKeys };
  }).then(async ({ update, removedStorageKeys }) => {
    await removeProjectUpdateFiles(update.id, removedStorageKeys);
    return update;
  });
}

async function removeProjectUpdateFiles(
  projectUpdateId: string,
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
    console.error("PROJECT_UPDATE_ATTACHMENT_FILE_DELETE_FAILED", {
      projectUpdateId,
      failedCount,
    });
  }
}

export function listUpdateComments(
  actor: Actor,
  projectId: string,
  projectUpdateId: string,
) {
  return withActorDb(actor, async (tx) => {
    const context = await assertCanViewCustomerProjectFeature(
      tx,
      actor,
      projectId,
      "updates",
    );
    const update = await tx.projectUpdate.findFirst({
      where: { id: projectUpdateId, projectId },
      select: { id: true, visibility: true },
    });
    assertFound(update, "进度动态不存在");
    assertAllowed(
      canViewContent(actor, context.access, update.visibility),
      "无权查看该进度动态",
    );

    return tx.updateComment.findMany({
      where: {
        projectUpdateId,
        visibility: actor.isStaff ? undefined : "CUSTOMER_VISIBLE",
      },
      include: {
        author: {
          select: { id: true, name: true },
        },
      },
      orderBy: { createdAt: "asc" },
    });
  });
}

export function createUpdateComment(
  actor: Actor,
  projectId: string,
  projectUpdateId: string,
  input: CreateUpdateCommentInput,
) {
  return withActorDb(actor, async (tx) => {
    const context = await assertCanViewCustomerProjectFeature(
      tx,
      actor,
      projectId,
      "updates",
    );
    const update = await tx.projectUpdate.findFirst({
      where: { id: projectUpdateId, projectId },
      select: { id: true, visibility: true },
    });
    assertFound(update, "进度动态不存在");
    assertAllowed(
      canViewContent(actor, context.access, update.visibility),
      "无权评论该进度动态",
    );
    assertAllowed(
      actor.isStaff || input.visibility !== "INTERNAL",
      "客户不能创建内部评论",
    );

    const visibility = actor.isStaff
      ? (input.visibility ?? "CUSTOMER_VISIBLE")
      : "CUSTOMER_VISIBLE";
    const comment = await tx.updateComment.create({
      data: {
        body: input.body,
        visibility,
        projectUpdateId,
        authorId: actor.id,
      },
      include: {
        author: {
          select: { id: true, name: true },
        },
      },
    });
    await writeAuditLog(tx, actor, {
      action: "UPDATE_COMMENT_CREATED",
      resourceType: "UpdateComment",
      resourceId: comment.id,
      customerSpaceId: context.customerSpaceId,
      projectId,
      metadata: {
        projectUpdateId,
        visibility: comment.visibility,
      },
    });
    await dispatchProjectActivity(tx, actor, {
      eventType: "UPDATE_COMMENT_CREATED",
      eventPayload: {
        projectId,
        projectUpdateId,
        updateCommentId: comment.id,
        actorId: actor.id,
      },
      notificationType: "UPDATE_COMMENT",
      notificationTitle: "项目动态有新评论",
      notificationBody: "项目进度动态收到了一条新评论。",
      visibility: comment.visibility,
      customerSpaceId: context.customerSpaceId,
      projectId,
    });
    return comment;
  });
}

export function updateUpdateComment(
  actor: Actor,
  projectId: string,
  projectUpdateId: string,
  updateCommentId: string,
  input: UpdateUpdateCommentInput,
) {
  return withActorDb(actor, async (tx) => {
    const context = await assertCanViewCustomerProjectFeature(
      tx,
      actor,
      projectId,
      "updates",
    );
    const comment = await tx.updateComment.findFirst({
      where: {
        id: updateCommentId,
        projectUpdateId,
        projectUpdate: { projectId },
      },
      select: {
        id: true,
        authorId: true,
        visibility: true,
      },
    });
    assertFound(comment, "评论不存在");
    assertAllowed(
      actor.isPlatformAdmin || comment.authorId === actor.id,
      "只能修改自己发布的评论",
    );
    assertAllowed(
      canViewContent(actor, context.access, comment.visibility),
      "无权修改该评论",
    );
    assertAllowed(
      actor.isStaff || input.visibility !== "INTERNAL",
      "客户不能将评论改为内部可见",
    );

    const data = {
      ...input,
      visibility: actor.isStaff ? input.visibility : undefined,
    };
    const updated = await tx.updateComment.update({
      where: { id: updateCommentId },
      data,
      include: {
        author: {
          select: { id: true, name: true },
        },
      },
    });
    await writeAuditLog(tx, actor, {
      action: "UPDATE_COMMENT_UPDATED",
      resourceType: "UpdateComment",
      resourceId: updated.id,
      customerSpaceId: context.customerSpaceId,
      projectId,
      metadata: auditMetadata(data),
    });
    await publishProjectChange(tx, actor, {
      change: "UPDATE_COMMENT_UPDATED",
      customerSpaceId: context.customerSpaceId,
      projectId,
      visibility: updated.visibility,
      payload: {
        projectUpdateId,
        updateCommentId: updated.id,
      },
    });
    return updated;
  });
}
