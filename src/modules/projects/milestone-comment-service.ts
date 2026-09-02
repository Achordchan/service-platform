import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import type { Actor } from "@/lib/actor";
import { withActorDb } from "@/lib/actor";
import { sanitizeMessageHtml } from "@/lib/sanitize-html";
import { removePrivateFile } from "@/modules/attachments/private-storage";
import { writeAuditLog } from "@/modules/audit/audit-service";
import {
  dispatchProjectActivity,
  publishProjectChange,
} from "@/modules/notifications/notification-service";
import {
  assertCanCommentOnProjectUpdate,
  assertCanViewProject,
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
  CreateMilestoneCommentInput,
  UpdateMilestoneCommentInput,
} from "@/modules/projects/schemas";

function auditMetadata(value: unknown) {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function sanitizeMilestoneCommentBody(body: string) {
  // 与动态评论同一套消毒规则：干净 HTML 进库，读取侧不再二次消毒
  const sanitized = sanitizeMessageHtml(body);
  return sanitized;
}

/**
 * 里程碑可见性裁决：客户要看里程碑，showMilestones 或 showProgress 至少开一个
 * （进度视图会把里程碑带出来，评论随之可见）。里程碑不可见则评论一并不存在。
 */
async function assertMilestoneVisible(
  tx: Prisma.TransactionClient,
  actor: Actor,
  projectId: string,
  milestoneId: string,
) {
  const context = await assertCanViewProject(tx, actor, projectId);
  if (
    !actor.isStaff &&
    !context.customerFeatures.milestones &&
    !context.customerFeatures.progress
  ) {
    throw new DomainError("NOT_FOUND", "项目功能未开放", 404);
  }
  const milestone = await tx.milestone.findFirst({
    where: { id: milestoneId, projectId },
    select: { id: true },
  });
  assertFound(milestone, "里程碑不存在");
  return context;
}

/**
 * 评论创建要比「可查看」多一道父内容状态校验：里程碑被撤回后，
 * 前端会隐藏评论区，服务端也必须阻止绕过 UI 的直接 API 提交。
 */
async function assertMilestoneCommentable(
  tx: Prisma.TransactionClient,
  actor: Actor,
  projectId: string,
  milestoneId: string,
) {
  const context = await assertMilestoneVisible(
    tx,
    actor,
    projectId,
    milestoneId,
  );
  const contentRisk = await loadContentRiskPageState(
    [{ targetType: "MILESTONE", targetId: milestoneId }],
    tx,
  );
  assertAllowed(
    !isContentRiskStateRevoked(
      contentRisk.states.get(`MILESTONE:${milestoneId}`),
    ),
    "里程碑已撤回，不能继续评论",
  );
  return context;
}

export function listMilestoneComments(
  actor: Actor,
  projectId: string,
  milestoneId: string,
) {
  return withActorDb(actor, async (tx) => {
    await assertMilestoneVisible(tx, actor, projectId, milestoneId);

    const comments = await tx.milestoneComment.findMany({
      where: {
        milestoneId,
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
        targetType: "MILESTONE_COMMENT" as const,
        targetId: comment.id,
      })),
      tx,
    );
    return comments.map((comment) => {
      const state = contentRisk.states.get(`MILESTONE_COMMENT:${comment.id}`);
      return {
        ...comment,
        body:
          !actor.isPlatformAdmin && isContentRiskStateRevoked(state)
            ? ""
            : sanitizeMessageHtml(comment.body),
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

export async function createMilestoneComment(
  actor: Actor,
  projectId: string,
  milestoneId: string,
  input: CreateMilestoneCommentInput,
) {
  const preflightContext = await withActorDb(actor, (tx) =>
    assertMilestoneCommentable(tx, actor, projectId, milestoneId),
  );
  await enforceActorPublicContentRules(actor, {
    targetType: "MILESTONE_COMMENT",
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
    const context = await assertMilestoneCommentable(
      tx,
      actor,
      projectId,
      milestoneId,
    );
    assertAllowed(
      actor.isStaff || input.visibility !== "INTERNAL",
      "客户不能创建内部评论",
    );
    if (actor.isStaff) {
      // 员工端与动态评论同一把权限钥匙：update.comment
      await assertCanCommentOnProjectUpdate(tx, actor, projectId);
    }

    const visibility = actor.isStaff
      ? (input.visibility ?? "CUSTOMER_VISIBLE")
      : "CUSTOMER_VISIBLE";
    const body = sanitizeMilestoneCommentBody(input.body);
    const comment = await tx.milestoneComment.create({
      data: {
        body,
        visibility,
        milestoneId,
        authorId: actor.id,
      },
      include: {
        author: {
          select: { id: true, name: true },
        },
      },
    });
    const contentRiskReview = await createContentRiskReview(tx, {
      targetType: "MILESTONE_COMMENT",
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
      action: "MILESTONE_COMMENT_CREATED",
      resourceType: "MilestoneComment",
      resourceId: comment.id,
      customerSpaceId: context.customerSpaceId,
      projectId,
      metadata: {
        milestoneId,
        visibility: comment.visibility,
      },
    });
    const delivery = await dispatchProjectActivity(tx, actor, {
      eventType: "PROJECT_UPDATED",
      eventPayload: {
        change: "MILESTONE_COMMENT_CREATED",
        projectId,
        milestoneId,
        milestoneCommentId: comment.id,
        actorId: actor.id,
      },
      notificationType: "UPDATE_COMMENT",
      notificationTitle: "项目里程碑有新评论",
      notificationBody: "项目里程碑收到了一条新评论。",
      visibility: comment.visibility,
      customerSpaceId: context.customerSpaceId,
      projectId,
      contentRiskReviewId: contentRiskReview?.id,
    });
    return { ...comment, deliveryFeedback: delivery.feedback };
  });
}

export async function updateMilestoneComment(
  actor: Actor,
  projectId: string,
  milestoneId: string,
  milestoneCommentId: string,
  input: UpdateMilestoneCommentInput,
) {
  const preflight = await withActorDb(actor, async (tx) => ({
    context: await assertMilestoneVisible(tx, actor, projectId, milestoneId),
    comment: await tx.milestoneComment.findFirst({
      where: {
        id: milestoneCommentId,
        milestoneId,
      },
      select: { body: true, visibility: true },
    }),
  }));
  assertFound(preflight.comment, "评论不存在");
  const reviewedComment = preflight.comment;
  await enforceActorPublicContentRules(actor, {
    targetType: "MILESTONE_COMMENT",
    customerSpaceId: preflight.context.customerSpaceId,
    projectId,
    serviceRequestId: null,
    snapshot: {
      body: input.body ?? reviewedComment.body,
      visibility:
        actor.isStaff
          ? input.visibility ?? reviewedComment.visibility
          : "CUSTOMER_VISIBLE",
    },
  });
  return withActorDb(actor, async (tx) => {
    const context = await assertMilestoneVisible(tx, actor, projectId, milestoneId);
    // 公开内容检查在事务外执行，避免长时间占用数据库事务。
    // 写入前锁住评论并与已审核快照对比：只要期间的正文或可见性
    // 发生过变化就拒绝本次写入，防止未审核内容被并发切换为客户可见。
    await tx.$queryRaw`
      SELECT id
      FROM "MilestoneComment"
      WHERE id = ${milestoneCommentId}
        AND "milestoneId" = ${milestoneId}
      FOR UPDATE
    `;
    const comment = await tx.milestoneComment.findFirst({
      where: {
        id: milestoneCommentId,
        milestoneId,
      },
      select: {
        id: true,
        body: true,
        authorId: true,
        visibility: true,
      },
    });
    assertFound(comment, "评论不存在");
    if (
      comment.body !== reviewedComment.body ||
      comment.visibility !== reviewedComment.visibility
    ) {
      throw new DomainError(
        "MILESTONE_COMMENT_CONFLICT",
        "评论已更新，请刷新后重试",
        409,
      );
    }
    // 作者本人才行，管理员也不例外：改客户说过的话不该是后台的能力，
    // 违规内容走内容风控的撤回，而不是替对方改写（与动态评论同口径）
    assertAllowed(comment.authorId === actor.id, "只能修改自己发布的评论");
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
      ...(input.body === undefined
        ? {}
        : { body: sanitizeMilestoneCommentBody(input.body) }),
      visibility: actor.isStaff ? input.visibility : undefined,
    };
    const updated = await tx.milestoneComment.update({
      where: { id: milestoneCommentId },
      data,
      include: {
        author: {
          select: { id: true, name: true },
        },
      },
    });
    await createContentRiskReview(tx, {
      targetType: "MILESTONE_COMMENT",
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
    });
    await writeAuditLog(tx, actor, {
      action: "MILESTONE_COMMENT_UPDATED",
      resourceType: "MilestoneComment",
      resourceId: updated.id,
      customerSpaceId: context.customerSpaceId,
      projectId,
      metadata: auditMetadata(data),
    });
    // 从客户可见收紧为内部时，客户仍要收到这条实时刷新，
    // 才能立即把已渲染的旧评论移除。事件覆盖「旧/新」两个受众的并集，
    // 但重新查询仍受 RLS 和 visibility 限制，不会把内部内容发给客户。
    const realtimeVisibility =
      comment.visibility === "CUSTOMER_VISIBLE" ||
      updated.visibility === "CUSTOMER_VISIBLE"
        ? "CUSTOMER_VISIBLE"
        : "INTERNAL";
    await publishProjectChange(tx, actor, {
      change: "MILESTONE_COMMENT_UPDATED",
      customerSpaceId: context.customerSpaceId,
      projectId,
      visibility: realtimeVisibility,
      payload: {
        milestoneId,
        milestoneCommentId: updated.id,
      },
    });
    return updated;
  });
}

export function deleteMilestoneComment(
  actor: Actor,
  projectId: string,
  milestoneId: string,
  milestoneCommentId: string,
) {
  return withActorDb(actor, async (tx) => {
    const context = await assertMilestoneVisible(tx, actor, projectId, milestoneId);
    const comment = await tx.milestoneComment.findFirst({
      where: {
        id: milestoneCommentId,
        milestoneId,
      },
      select: {
        id: true,
        body: true,
        authorId: true,
        visibility: true,
        attachments: {
          select: { storageKey: true, previewStorageKey: true },
        },
      },
    });
    assertFound(comment, "评论不存在");
    // 与动态评论的删除同口径：作者本人，或持有评论权限的员工
    assertAllowed(
      comment.authorId === actor.id || actor.isStaff,
      "只能删除自己发布的评论",
    );
    if (actor.isStaff && comment.authorId !== actor.id) {
      await assertCanCommentOnProjectUpdate(tx, actor, projectId);
    }
    assertAllowed(
      canViewContent(actor, context.access, comment.visibility),
      "无权删除该评论",
    );

    const storageKeys = comment.attachments.flatMap((attachment) =>
      [attachment.storageKey, attachment.previewStorageKey].filter(
        (value): value is string => Boolean(value),
      ),
    );

    await tx.milestoneComment.delete({
      where: { id: milestoneCommentId },
    });
    await writeAuditLog(tx, actor, {
      action: "MILESTONE_COMMENT_DELETED",
      resourceType: "MilestoneComment",
      resourceId: milestoneCommentId,
      customerSpaceId: context.customerSpaceId,
      projectId,
      // storageKeys 跟删除审计进同一事务：物理删除前进程若重启，仍能从
      // 审计恢复待清理键，不会变成彻底失联的孤儿文件。
      metadata: {
        milestoneId,
        authorId: comment.authorId,
        storageKeys,
      },
    });
    await publishProjectChange(tx, actor, {
      change: "MILESTONE_COMMENT_DELETED",
      customerSpaceId: context.customerSpaceId,
      projectId,
      visibility: comment.visibility,
      payload: {
        milestoneId,
        milestoneCommentId,
      },
    });
    return { storageKeys };
  }).then(async ({ storageKeys }) => {
    const failed: Array<{ storageKey: string; error: string }> = [];
    for (const storageKey of storageKeys) {
      try {
        await removePrivateFile(storageKey);
      } catch (error) {
        failed.push({
          storageKey,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    if (failed.length > 0) {
      console.error("MILESTONE_COMMENT_ATTACHMENT_FILE_DELETE_FAILED", {
        milestoneCommentId,
        failed,
      });
      try {
        await withActorDb(actor, (tx) =>
          writeAuditLog(tx, actor, {
            action: "MILESTONE_COMMENT_ATTACHMENT_FILE_DELETE_FAILED",
            resourceType: "MilestoneComment",
            resourceId: milestoneCommentId,
            result: "FAILED",
            projectId,
            metadata: { milestoneId, failed },
          }),
        );
      } catch (auditError) {
        console.error("MILESTONE_COMMENT_FILE_DELETE_AUDIT_FAILED", {
          milestoneCommentId,
          auditError,
        });
      }
    }
    return { deleted: true as const };
  });
}
