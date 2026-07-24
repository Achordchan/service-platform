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
  assertCanCommentOnProjectUpdate,
  assertCanPublishActiveProjectUpdate,
  assertCanViewCustomerProjectFeature,
} from "@/modules/projects/project-access";
import {
  assertAllowed,
  assertFound,
  DomainError,
} from "@/modules/projects/errors";
import { canViewContent } from "@/modules/projects/permissions";
import {
  createContentRiskReview,
  enforceActorPublicContentRules,
} from "@/modules/plugins/content-risk-service";
import {
  contentRiskStatusFor,
  isContentRiskStateRevoked,
  loadContentRiskPageState,
} from "@/modules/plugins/content-risk-view-service";
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
    const comments = updates.flatMap((update) => update.comments);
    const contentRisk = await loadContentRiskPageState(
      [
        ...updates.map((update) => ({
          targetType: "PROJECT_UPDATE" as const,
          targetId: update.id,
        })),
        ...comments.map((comment) => ({
          targetType: "UPDATE_COMMENT" as const,
          targetId: comment.id,
        })),
      ],
      tx,
    );
    const riskStatus = (
      targetType: "PROJECT_UPDATE" | "UPDATE_COMMENT",
      targetId: string,
      authoredByCurrentUser: boolean,
    ) =>
      actor.isPlatformAdmin
        ? null
        : contentRiskStatusFor(
            contentRisk.states.get(`${targetType}:${targetId}`),
            {
              pluginEnabled: contentRisk.enabled,
              showPending: authoredByCurrentUser,
            },
          );
    return updates.map((update) => ({
      ...update,
      title:
        !actor.isPlatformAdmin &&
        isContentRiskStateRevoked(
          contentRisk.states.get(`PROJECT_UPDATE:${update.id}`),
        )
          ? ""
          : update.title,
      body:
        !actor.isPlatformAdmin &&
        isContentRiskStateRevoked(
          contentRisk.states.get(`PROJECT_UPDATE:${update.id}`),
        )
          ? ""
          : sanitizeMessageHtml(update.body),
      contentRiskStatus: riskStatus(
        "PROJECT_UPDATE",
        update.id,
        update.authorId === actor.id,
      ),
      comments: update.comments.map((comment) => ({
        ...comment,
        body:
          !actor.isPlatformAdmin &&
          isContentRiskStateRevoked(
            contentRisk.states.get(`UPDATE_COMMENT:${comment.id}`),
          )
            ? ""
            : comment.body,
        contentRiskStatus: riskStatus(
          "UPDATE_COMMENT",
          comment.id,
          comment.authorId === actor.id,
        ),
      })),
    }));
  });
}

export async function createProjectUpdate(
  actor: Actor,
  projectId: string,
  input: CreateProjectUpdateInput,
) {
  const preflightContext = await withActorDb(actor, (tx) =>
    assertCanPublishActiveProjectUpdate(tx, actor, projectId),
  );
  await enforceActorPublicContentRules(actor, {
    targetType: "PROJECT_UPDATE",
    customerSpaceId: preflightContext.customerSpaceId,
    projectId,
    serviceRequestId: null,
    snapshot: {
      title: input.title,
      body: input.body,
      visibility: input.visibility ?? "CUSTOMER_VISIBLE",
    },
  });
  return withActorDb(actor, async (tx) => {
    const context = await assertCanPublishActiveProjectUpdate(
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
    const contentRiskReview = await createContentRiskReview(tx, {
      targetType: "PROJECT_UPDATE",
      targetId: update.id,
      actorId: actor.id,
      actorName: actor.name,
      actorKind: actor.platformRole === "CUSTOMER" ? "CUSTOMER" : "STAFF",
      isPlatformAdmin: actor.isPlatformAdmin,
      customerSpaceId: context.customerSpaceId,
      projectId,
      serviceRequestId: null,
      snapshot: {
        title: update.title,
        body: update.body,
        visibility: update.visibility,
        attachmentIds: extractInlineAttachmentIds(body),
      },
    });
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
    const delivery = await dispatchProjectActivity(tx, actor, {
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
      contentRiskReviewId: contentRiskReview?.id,
    });
    return { ...update, deliveryFeedback: delivery.feedback };
  });
}

export async function updateProjectUpdate(
  actor: Actor,
  projectId: string,
  projectUpdateId: string,
  input: UpdateProjectUpdateInput,
) {
  const preflight = await withActorDb(actor, async (tx) => {
    const context = await assertCanPublishActiveProjectUpdate(tx, actor, projectId);
    const existing = await tx.projectUpdate.findFirst({
      where: { id: projectUpdateId, projectId },
      select: { title: true, body: true, visibility: true },
    });
    return { context, existing };
  });
  if (preflight.existing) {
    await enforceActorPublicContentRules(actor, {
      targetType: "PROJECT_UPDATE",
      customerSpaceId: preflight.context.customerSpaceId,
      projectId,
      serviceRequestId: null,
      snapshot: {
        title: input.title ?? preflight.existing.title,
        body: input.body ?? preflight.existing.body,
        visibility: input.visibility ?? preflight.existing.visibility,
      },
    });
  }
  return withActorDb(actor, async (tx) => {
    const context = await assertCanPublishActiveProjectUpdate(
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
    const contentRiskReview = await createContentRiskReview(tx, {
      targetType: "PROJECT_UPDATE",
      targetId: update.id,
      actorId: actor.id,
      actorName: actor.name,
      actorKind: actor.platformRole === "CUSTOMER" ? "CUSTOMER" : "STAFF",
      isPlatformAdmin: actor.isPlatformAdmin,
      customerSpaceId: context.customerSpaceId,
      projectId,
      serviceRequestId: null,
      snapshot: {
        title: update.title,
        body: update.body,
        visibility: update.visibility,
        attachmentIds: extractInlineAttachmentIds(update.body),
      },
      previousSnapshot: {
        title: preflight.existing?.title ?? update.title,
        body: existing.body,
        visibility: existing.visibility,
        attachmentIds: extractInlineAttachmentIds(existing.body),
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
    if (removedAttachments.length > 0 && !contentRiskReview) {
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

export function deleteProjectUpdate(
  actor: Actor,
  projectId: string,
  projectUpdateId: string,
) {
  return withActorDb(actor, async (tx) => {
    const context = await assertCanPublishActiveProjectUpdate(
      tx,
      actor,
      projectId,
    );
    const existing = await tx.projectUpdate.findFirst({
      where: { id: projectUpdateId, projectId },
      select: {
        id: true,
        title: true,
        visibility: true,
        attachments: {
          select: { storageKey: true },
        },
        comments: {
          select: {
            attachments: {
              select: { storageKey: true },
            },
          },
        },
      },
    });
    assertFound(existing, "进度动态不存在");

    const storageKeys = [
      ...existing.attachments.map((attachment) => attachment.storageKey),
      ...existing.comments.flatMap((comment) =>
        comment.attachments.map((attachment) => attachment.storageKey),
      ),
    ];

    await tx.projectUpdate.delete({
      where: { id: existing.id },
    });
    await writeAuditLog(tx, actor, {
      action: "PROJECT_UPDATE_DELETED",
      resourceType: "ProjectUpdate",
      resourceId: existing.id,
      customerSpaceId: context.customerSpaceId,
      projectId,
      metadata: {
        title: existing.title,
        visibility: existing.visibility,
      },
    });
    await publishProjectChange(tx, actor, {
      change: "PROJECT_UPDATE_DELETED",
      customerSpaceId: context.customerSpaceId,
      projectId,
      visibility: existing.visibility,
      payload: { projectUpdateId: existing.id },
    });

    return { projectUpdateId: existing.id, storageKeys };
  }).then(async ({ projectUpdateId, storageKeys }) => {
    await removeProjectUpdateFiles(projectUpdateId, storageKeys);
    return { deleted: true as const };
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

    const comments = await tx.updateComment.findMany({
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
    const contentRisk = await loadContentRiskPageState(
      comments.map((comment) => ({
        targetType: "UPDATE_COMMENT" as const,
        targetId: comment.id,
      })),
      tx,
    );
    return comments.map((comment) => {
      const state = contentRisk.states.get(`UPDATE_COMMENT:${comment.id}`);
      return {
        ...comment,
        body:
          !actor.isPlatformAdmin && isContentRiskStateRevoked(state)
            ? ""
            : comment.body,
        contentRiskStatus: actor.isPlatformAdmin
          ? null
          : contentRiskStatusFor(state, {
              pluginEnabled: contentRisk.enabled,
              showPending: comment.authorId === actor.id,
            }),
      };
    });
  });
}

export async function createUpdateComment(
  actor: Actor,
  projectId: string,
  projectUpdateId: string,
  input: CreateUpdateCommentInput,
) {
  const preflightContext = await withActorDb(actor, (tx) =>
    assertCanViewCustomerProjectFeature(tx, actor, projectId, "updates"),
  );
  await enforceActorPublicContentRules(actor, {
    targetType: "UPDATE_COMMENT",
    customerSpaceId: preflightContext.customerSpaceId,
    projectId,
    serviceRequestId: null,
    snapshot: {
      body: input.body,
      visibility:
        actor.isStaff ? input.visibility ?? "CUSTOMER_VISIBLE" : "CUSTOMER_VISIBLE",
    },
  });
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
    if (actor.isStaff) {
      await assertCanCommentOnProjectUpdate(tx, actor, projectId);
    }

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
    const contentRiskReview = await createContentRiskReview(tx, {
      targetType: "UPDATE_COMMENT",
      targetId: comment.id,
      actorId: actor.id,
      actorName: actor.name,
      actorKind: actor.platformRole === "CUSTOMER" ? "CUSTOMER" : "STAFF",
      isPlatformAdmin: actor.isPlatformAdmin,
      customerSpaceId: context.customerSpaceId,
      projectId,
      serviceRequestId: null,
      snapshot: {
        body: comment.body,
        visibility: comment.visibility,
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
      contentRiskReviewId: contentRiskReview?.id,
    });
    return comment;
  });
}

export async function updateUpdateComment(
  actor: Actor,
  projectId: string,
  projectUpdateId: string,
  updateCommentId: string,
  input: UpdateUpdateCommentInput,
) {
  const preflight = await withActorDb(actor, async (tx) => ({
    context: await assertCanViewCustomerProjectFeature(
      tx,
      actor,
      projectId,
      "updates",
    ),
    comment: await tx.updateComment.findFirst({
      where: {
        id: updateCommentId,
        projectUpdateId,
        projectUpdate: { projectId },
      },
      select: { body: true, visibility: true },
    }),
  }));
  if (preflight.comment) {
    await enforceActorPublicContentRules(actor, {
      targetType: "UPDATE_COMMENT",
      customerSpaceId: preflight.context.customerSpaceId,
      projectId,
      serviceRequestId: null,
      snapshot: {
        body: input.body ?? preflight.comment.body,
        visibility:
          actor.isStaff
            ? input.visibility ?? preflight.comment.visibility
            : "CUSTOMER_VISIBLE",
      },
    });
  }
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
        body: true,
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
    if (actor.isStaff) {
      await assertCanCommentOnProjectUpdate(tx, actor, projectId);
    }

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
    await createContentRiskReview(tx, {
      targetType: "UPDATE_COMMENT",
      targetId: updated.id,
      actorId: actor.id,
      actorName: actor.name,
      actorKind: actor.platformRole === "CUSTOMER" ? "CUSTOMER" : "STAFF",
      isPlatformAdmin: actor.isPlatformAdmin,
      customerSpaceId: context.customerSpaceId,
      projectId,
      serviceRequestId: null,
      snapshot: {
        body: updated.body,
        visibility: updated.visibility,
      },
      previousSnapshot: {
        body: comment.body,
        visibility: comment.visibility,
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
