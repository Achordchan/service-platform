import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import type { Actor } from "@/lib/actor";
import { withActorDb } from "@/lib/actor";
import { writeAuditLog } from "@/modules/audit/audit-service";
import { dispatchProjectActivity } from "@/modules/notifications/notification-service";
import {
  assertCanManageProjectDelivery,
  assertCanViewProject,
} from "@/modules/projects/project-access";
import { assertAllowed, assertFound } from "@/modules/projects/errors";
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

export function listProjectUpdates(actor: Actor, projectId: string) {
  return withActorDb(actor, async (tx) => {
    await assertCanViewProject(tx, actor, projectId);
    return tx.projectUpdate.findMany({
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
  });
}

export function createProjectUpdate(
  actor: Actor,
  projectId: string,
  input: CreateProjectUpdateInput,
) {
  return withActorDb(actor, async (tx) => {
    const context = await assertCanManageProjectDelivery(tx, actor, projectId);
    const update = await tx.projectUpdate.create({
      data: {
        title: input.title,
        body: input.body,
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
    const context = await assertCanManageProjectDelivery(tx, actor, projectId);
    const existing = await tx.projectUpdate.findFirst({
      where: { id: projectUpdateId, projectId },
      select: { id: true },
    });
    assertFound(existing, "进度动态不存在");

    const update = await tx.projectUpdate.update({
      where: { id: projectUpdateId },
      data: input,
      include: {
        author: {
          select: { id: true, name: true },
        },
      },
    });
    await writeAuditLog(tx, actor, {
      action: "PROJECT_UPDATE_UPDATED",
      resourceType: "ProjectUpdate",
      resourceId: update.id,
      customerSpaceId: context.customerSpaceId,
      projectId,
      metadata: auditMetadata(input),
    });
    return update;
  });
}

export function listUpdateComments(
  actor: Actor,
  projectId: string,
  projectUpdateId: string,
) {
  return withActorDb(actor, async (tx) => {
    const context = await assertCanViewProject(tx, actor, projectId);
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
    const context = await assertCanViewProject(tx, actor, projectId);
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
    const context = await assertCanViewProject(tx, actor, projectId);
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
    return updated;
  });
}
