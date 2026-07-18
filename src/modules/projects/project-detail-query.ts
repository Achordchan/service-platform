import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import type { Actor } from "@/lib/actor";
import { calculateProjectProgress } from "@/modules/projects/progress";
import { projectBaseSelect } from "@/modules/projects/project-summary-query";

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
  const requestCategories = await tx.requestCategory.findMany({
    where: { serviceTypeId: project.serviceTypeId, active: true },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
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
  const milestones = await tx.milestone.findMany({
    where: { projectId },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
  const updates = await tx.projectUpdate.findMany({
    where: {
      projectId,
      ...(actor.isStaff ? {} : { visibility: "CUSTOMER_VISIBLE" as const }),
    },
    orderBy: { createdAt: "desc" },
  });
  const comments = await tx.updateComment.findMany({
    where: {
      projectUpdateId: { in: updates.map((update) => update.id) },
      ...(actor.isStaff ? {} : { visibility: "CUSTOMER_VISIBLE" as const }),
    },
    orderBy: { createdAt: "asc" },
  });
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
  const attachments = await tx.attachment.findMany({
    where: {
      projectId,
      projectUpdateId: null,
      updateCommentId: null,
      serviceRequestId: null,
      requestMessageId: null,
      ...(actor.isStaff ? {} : { visibility: "CUSTOMER_VISIBLE" as const }),
    },
    select: {
      id: true,
      originalName: true,
      mimeType: true,
      size: true,
      visibility: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
  });
  const pluginBindings = await tx.projectPluginBinding.findMany({
    where: { projectId },
    select: { pluginKey: true, status: true },
  });

  const staffUserById = new Map(staffUsers.map((user) => [user.id, user]));
  const authorById = new Map(contentAuthors.map((user) => [user.id, user]));
  const commentsByUpdateId = new Map<string, typeof comments>();
  for (const comment of comments) {
    const current = commentsByUpdateId.get(comment.projectUpdateId) ?? [];
    current.push(comment);
    commentsByUpdateId.set(comment.projectUpdateId, current);
  }
  const progress = calculateProjectProgress(milestones);
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
    milestones,
    updates: updates.map((update) => ({
      ...update,
      author: authorById.get(update.authorId)!,
      comments: (commentsByUpdateId.get(update.id) ?? []).map((comment) => ({
        ...comment,
        author: authorById.get(comment.authorId)!,
      })),
    })),
    attachments,
    pluginBindings,
    progress: progress.percentage,
    progressDetails: progress.counts,
  };
}
