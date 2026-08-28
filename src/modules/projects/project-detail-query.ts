import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import type { Actor } from "@/lib/actor";
import { sanitizeMessageHtml } from "@/lib/sanitize-html";
import { calculateProjectProgress } from "@/modules/projects/progress";
import { projectBaseSelect } from "@/modules/projects/project-summary-query";
import {
  contentRiskStatusFor,
  isContentRiskStateRevoked,
  loadContentRiskPageState,
} from "@/modules/plugins/content-risk-view-service";

export async function loadProjectDetail(
  tx: Prisma.TransactionClient,
  actor: Actor,
  projectId: string,
) {
  const project = await tx.project.findUnique({
    where: { id: projectId },
    select: projectBaseSelect,
  });
  if (!project) return null;
  const customerSpace = await tx.customerSpace.findUniqueOrThrow({
    where: { id: project.customerSpaceId },
    select: { id: true, name: true, slug: true, status: true },
  });
  const serviceType = await tx.serviceType.findUniqueOrThrow({
    where: { id: project.serviceTypeId },
    select: { id: true, key: true, name: true },
  });
  const requestCategories =
    actor.isStaff || project.customerRequestsEnabled
      ? await tx.requestCategory.findMany({
          where: { serviceTypeId: project.serviceTypeId, active: true },
          select: { id: true, name: true },
          orderBy: { name: "asc" },
        })
      : [];
  const staffRows = await tx.projectStaff.findMany({
    where: { projectId },
    select: {
      id: true,
      projectId: true,
      userId: true,
      role: true,
      createdAt: true,
    },
    orderBy: { createdAt: "asc" },
  });
  const staffUsers = await tx.user.findMany({
    where: { id: { in: staffRows.map((row) => row.userId) } },
    select: {
      id: true,
      name: true,
      email: true,
      platformRole: true,
    },
  });
  const shouldLoadMilestones =
    actor.isStaff || project.showMilestones || project.showProgress;
  const milestoneRows = shouldLoadMilestones
    ? await tx.milestone.findMany({
        where: { projectId },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      })
    : [];
  const updates =
    actor.isStaff || project.customerUpdatesEnabled
      ? await tx.projectUpdate.findMany({
          where: {
            projectId,
            ...(actor.isStaff
              ? {}
              : { visibility: "CUSTOMER_VISIBLE" as const }),
          },
          orderBy: { createdAt: "desc" },
        })
      : [];
  const comments = await tx.updateComment.findMany({
    where: {
      projectUpdateId: { in: updates.map((update) => update.id) },
      ...(actor.isStaff ? {} : { visibility: "CUSTOMER_VISIBLE" as const }),
    },
    orderBy: { createdAt: "asc" },
  });
  const updatesWithRevisions = actor.isStaff
    ? new Set(
        (
          await tx.projectUpdateRevision.findMany({
            where: { projectUpdateId: { in: updates.map((update) => update.id) } },
            select: { projectUpdateId: true },
            distinct: ["projectUpdateId"],
          })
        ).map((row) => row.projectUpdateId),
      )
    : new Set<string>();
  const commentsWithRevisions = actor.isStaff
    ? new Set(
        (
          await tx.updateCommentRevision.findMany({
            where: {
              updateCommentId: { in: comments.map((comment) => comment.id) },
            },
            select: { updateCommentId: true },
            distinct: ["updateCommentId"],
          })
        ).map((row) => row.updateCommentId),
      )
    : new Set<string>();
  const contentAuthors = await tx.user.findMany({
    where: {
      id: {
        in: Array.from(
          new Set([
            ...updates.map((update) => update.authorId),
            ...comments.map((comment) => comment.authorId),
          ]),
        ),
      },
    },
    select: { id: true, name: true },
  });
  // 不在这里按 customerFilesEnabled 一刀切：RLS 的
  // app_project_attachment_feature_enabled 已经按附件挂在谁身上分别裁决 ——
  // 动态/评论看 customerUpdatesEnabled、里程碑看 showMilestones、
  // 项目级文件才看 customerFilesEnabled。外层再加一道粗门控的话，
  // 「开着动态、关着文件」的项目里客户能看到动态正文却看不到它的附件。
  // 受 customerFilesEnabled 限制的只是文件 tab 那个聚合列表（见返回值）。
  const attachments = await tx.attachment.findMany({
    where: {
      projectId,
      ...(actor.isStaff
        ? {}
        : { visibility: "CUSTOMER_VISIBLE" as const }),
      OR: [
        // 项目级手动上传
        {
          projectUpdateId: null,
          updateCommentId: null,
          milestoneId: null,
          serviceRequestId: null,
          requestMessageId: null,
          inline: false,
        },
        // 进度动态 / 里程碑上的文件附件：自动收录，无需手动添加
        // （正文内嵌图不算文件，仍排除）
        { projectUpdateId: { not: null }, inline: false },
        { milestoneId: { not: null }, inline: false },
        // 从工单聊天里显式「添加到项目文件」的。RLS 仍按原归属裁决，
        // 看不到源工单的人读不到这些行，收录不放宽任何可见性。
        { pinnedToProjectAt: { not: null } },
      ],
    },
    select: {
      id: true,
      originalName: true,
      title: true,
      note: true,
      previewStatus: true,
      mimeType: true,
      size: true,
      visibility: true,
      uploadedById: true,
      createdAt: true,
      pinnedToProjectAt: true,
      serviceRequestId: true,
      projectUpdateId: true,
      updateCommentId: true,
      milestoneId: true,
      inline: true,
    },
    orderBy: { createdAt: "desc" },
  });
  const decorateAttachment = (attachment: (typeof attachments)[number]) => {
    const revoked =
      !actor.isPlatformAdmin &&
      riskStatus("ATTACHMENT", attachment.id, false) === "REVOKED";
    return {
      ...attachment,
      originalName: revoked ? "" : attachment.originalName,
      title: revoked ? null : attachment.title,
      note: revoked ? null : attachment.note,
      // 来源：让文件列表能按「项目文件 / 来自沟通」分流并标注出处
      source: attachment.serviceRequestId
        ? ("REQUEST" as const)
        : attachment.projectUpdateId || attachment.updateCommentId
          ? ("UPDATE" as const)
          : attachment.milestoneId
            ? ("MILESTONE" as const)
            : ("PROJECT" as const),
      pinned: Boolean(attachment.pinnedToProjectAt),
      contentRiskStatus: riskStatus(
        "ATTACHMENT",
        attachment.id,
        attachment.uploadedById === actor.id,
      ),
    };
  };
  // 同一批数据两用：文件 tab 用全量，动态/里程碑各自渲染自己的附件
  const attachmentsByUpdateId = new Map<string, typeof attachments>();
  const attachmentsByMilestoneId = new Map<string, typeof attachments>();
  for (const attachment of attachments) {
    if (attachment.inline) continue;
    if (attachment.projectUpdateId) {
      const list = attachmentsByUpdateId.get(attachment.projectUpdateId) ?? [];
      list.push(attachment);
      attachmentsByUpdateId.set(attachment.projectUpdateId, list);
    }
    if (attachment.milestoneId) {
      const list = attachmentsByMilestoneId.get(attachment.milestoneId) ?? [];
      list.push(attachment);
      attachmentsByMilestoneId.set(attachment.milestoneId, list);
    }
  }
  const pluginBindings = await tx.projectPluginBinding.findMany({
    where: { projectId },
    select: { pluginKey: true, status: true },
  });
  const contentRisk = await loadContentRiskPageState(
    [
      ...milestoneRows.map((milestone) => ({
        targetType: "MILESTONE" as const,
        targetId: milestone.id,
      })),
      ...updates.map((update) => ({
        targetType: "PROJECT_UPDATE" as const,
        targetId: update.id,
      })),
      ...comments.map((comment) => ({
        targetType: "UPDATE_COMMENT" as const,
        targetId: comment.id,
      })),
      ...attachments.map((attachment) => ({
        targetType: "ATTACHMENT" as const,
        targetId: attachment.id,
      })),
    ],
    tx,
  );
  const riskStatus = (
    targetType: "MILESTONE" | "PROJECT_UPDATE" | "UPDATE_COMMENT" | "ATTACHMENT",
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

  const staffUserById = new Map(staffUsers.map((user) => [user.id, user]));
  const authorById = new Map(contentAuthors.map((user) => [user.id, user]));
  const commentsByUpdateId = new Map<string, typeof comments>();
  for (const comment of comments) {
    const current = commentsByUpdateId.get(comment.projectUpdateId) ?? [];
    current.push(comment);
    commentsByUpdateId.set(comment.projectUpdateId, current);
  }
  const milestones =
    actor.isStaff || project.showMilestones ? milestoneRows : [];
  const progressMilestoneRows = milestoneRows.filter(
    (milestone) =>
      !isContentRiskStateRevoked(
        contentRisk.states.get(`MILESTONE:${milestone.id}`),
      ),
  );
  const progress =
    actor.isStaff || project.showProgress
      ? calculateProjectProgress(progressMilestoneRows)
      : { percentage: 0, counts: { total: 0, completed: 0, inProgress: 0, notStarted: 0 } };
  return {
    ...project,
    customerSpace,
    serviceType: { ...serviceType, requestCategories },
    staff: staffRows
      .map((row) => {
        const user = staffUserById.get(row.userId);
        if (!user) return null;
        return {
          ...row,
          user: actor.isStaff
            ? user
            : { id: user.id, name: user.name },
        };
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item)),
    milestones: milestones.map((milestone) => ({
      ...milestone,
      title:
        !actor.isPlatformAdmin &&
        riskStatus("MILESTONE", milestone.id, false) === "REVOKED"
          ? ""
          : milestone.title,
      contentRiskStatus: riskStatus(
        "MILESTONE",
        milestone.id,
        milestone.createdById === actor.id,
      ),
      description:
        !actor.isPlatformAdmin &&
        riskStatus("MILESTONE", milestone.id, false) === "REVOKED"
          ? null
          : milestone.description
            ? sanitizeMessageHtml(milestone.description)
            : null,
      attachments: (attachmentsByMilestoneId.get(milestone.id) ?? []).map(
        decorateAttachment,
      ),
    })),
    updates: updates.map((update) => ({
      ...update,
      title:
        !actor.isPlatformAdmin &&
        riskStatus("PROJECT_UPDATE", update.id, false) === "REVOKED"
          ? ""
          : update.title,
      contentRiskStatus: riskStatus(
        "PROJECT_UPDATE",
        update.id,
        update.authorId === actor.id,
      ),
      body:
        !actor.isPlatformAdmin &&
        riskStatus("PROJECT_UPDATE", update.id, false) === "REVOKED"
          ? ""
          : sanitizeMessageHtml(update.body),
      attachments: (attachmentsByUpdateId.get(update.id) ?? []).map(
        decorateAttachment,
      ),
      author: authorById.get(update.authorId)!,
      hasEditHistory: updatesWithRevisions.has(update.id),
      comments: (commentsByUpdateId.get(update.id) ?? []).map((comment) => ({
        ...comment,
        contentRiskStatus: riskStatus(
          "UPDATE_COMMENT",
          comment.id,
          comment.authorId === actor.id,
        ),
        body:
          !actor.isPlatformAdmin &&
          riskStatus("UPDATE_COMMENT", comment.id, false) === "REVOKED"
            ? ""
            : sanitizeMessageHtml(comment.body),
        author: authorById.get(comment.authorId)!,
        hasEditHistory: commentsWithRevisions.has(comment.id),
      })),
    })),
    // 文件 tab 的聚合列表才受「项目文件」模块开关限制；动态/里程碑自己的附件
    // 走上面的 attachmentsByUpdateId / attachmentsByMilestoneId，不受它影响
    attachments:
      actor.isStaff || project.customerFilesEnabled
        ? attachments.map(decorateAttachment)
        : [],
    pluginBindings,
    contentRiskUiEnabled: contentRisk.enabled,
    progress: progress.percentage,
    progressDetails: progress.counts,
  };
}
