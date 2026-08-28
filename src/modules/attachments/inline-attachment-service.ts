import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import type { Actor } from "@/lib/actor";
import type { ExternalActor } from "@/lib/external-actor";
import { withSystemDb } from "@/lib/system-db";
import { removePrivateFile } from "@/modules/attachments/private-storage";
import { DomainError } from "@/modules/projects/errors";

type InlineAttachmentTarget = {
  projectId: string;
  serviceRequestId?: string;
  requestMessageId?: string;
  projectUpdateId?: string;
  milestoneId?: string;
  visibility: "CUSTOMER_VISIBLE" | "INTERNAL";
};

function uniqueIds(ids: string[]) {
  const unique = Array.from(new Set(ids));
  if (unique.length > 20) {
    throw new DomainError(
      "INLINE_IMAGE_LIMIT_EXCEEDED",
      "单次最多插入 20 张正文图片",
      422,
    );
  }
  return unique;
}

export async function claimUserInlineAttachments(
  tx: Prisma.TransactionClient,
  actor: Actor,
  ids: string[],
  target: InlineAttachmentTarget,
) {
  const unique = uniqueIds(ids);
  if (unique.length === 0) return;

  const claimed = await tx.attachment.updateMany({
    where: {
      id: { in: unique },
      inline: true,
      uploadedById: actor.id,
      uploadedByExternalContactId: null,
      projectId: target.projectId,
      projectUpdateId: null,
      milestoneId: null,
      requestMessageId: null,
      OR: target.serviceRequestId
        ? [
            { serviceRequestId: null },
            { serviceRequestId: target.serviceRequestId },
          ]
        : [{ serviceRequestId: null }],
    },
    data: {
      visibility: target.visibility,
      serviceRequestId: target.serviceRequestId,
      requestMessageId: target.requestMessageId,
      projectUpdateId: target.projectUpdateId,
      milestoneId: target.milestoneId,
    },
  });
  if (claimed.count !== unique.length) {
    throw new DomainError(
      "INLINE_IMAGE_UNAVAILABLE",
      "正文图片不存在、已被使用或无权访问",
      409,
    );
  }
}

export async function claimSupportPlaybookInlineAttachments(
  tx: Prisma.TransactionClient,
  actor: Actor,
  ids: string[],
  supportPlaybookKey: string,
) {
  if (!actor.isPlatformAdmin) {
    throw new DomainError(
      "FORBIDDEN",
      "只有平台管理员可以管理回复指南图片",
      403,
    );
  }
  const unique = uniqueIds(ids);
  if (unique.length === 0) return;
  const claimed = await tx.attachment.updateMany({
    where: {
      id: { in: unique },
      inline: true,
      uploadedByExternalContactId: null,
      customerSpaceId: null,
      projectId: null,
      projectUpdateId: null,
      updateCommentId: null,
      milestoneId: null,
      serviceRequestId: null,
      requestMessageId: null,
      OR: [
        { supportPlaybookKey, uploadedById: { not: null } },
        { supportPlaybookKey: null, uploadedById: actor.id },
      ],
    },
    data: { supportPlaybookKey },
  });
  if (claimed.count !== unique.length) {
    throw new DomainError(
      "INLINE_IMAGE_UNAVAILABLE",
      "指南正文图片不存在、已被其他内容使用或无权访问",
      409,
    );
  }
}

export async function claimExternalInlineAttachments(
  tx: Prisma.TransactionClient,
  actor: ExternalActor,
  ids: string[],
  target: Omit<InlineAttachmentTarget, "visibility">,
) {
  const unique = uniqueIds(ids);
  if (unique.length === 0) return;

  const claimed = await tx.attachment.updateMany({
    where: {
      id: { in: unique },
      inline: true,
      uploadedById: null,
      uploadedByExternalContactId: actor.id,
      projectId: target.projectId,
      projectUpdateId: null,
      milestoneId: null,
      requestMessageId: null,
      OR: target.serviceRequestId
        ? [
            { serviceRequestId: null },
            { serviceRequestId: target.serviceRequestId },
          ]
        : [{ serviceRequestId: null }],
    },
    data: {
      visibility: "CUSTOMER_VISIBLE",
      serviceRequestId: target.serviceRequestId,
      requestMessageId: target.requestMessageId,
      projectUpdateId: target.projectUpdateId,
      milestoneId: target.milestoneId,
    },
  });
  if (claimed.count !== unique.length) {
    throw new DomainError(
      "INLINE_IMAGE_UNAVAILABLE",
      "正文图片不存在、已被使用或无权访问",
      409,
    );
  }
}

export async function cleanupAbandonedInlineAttachments() {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const candidates = await withSystemDb((tx) =>
    tx.attachment.findMany({
      where: {
        inline: true,
        requestMessageId: null,
        projectUpdateId: null,
        milestoneId: null,
        supportPlaybookKey: null,
        createdAt: { lt: cutoff },
      },
      select: { id: true, storageKey: true, previewStorageKey: true },
      orderBy: { createdAt: "asc" },
      take: 200,
    }),
  );

  let deleted = 0;
  for (const candidate of candidates) {
    const removed = await withSystemDb((tx) =>
      tx.attachment.deleteMany({
        where: {
          id: candidate.id,
          inline: true,
          requestMessageId: null,
          projectUpdateId: null,
          milestoneId: null,
          supportPlaybookKey: null,
          createdAt: { lt: cutoff },
        },
      }),
    );
    if (removed.count !== 1) continue;
    // 派生 PDF 预览件与源文件一起清理（inline 目前恒为图片、无预览件，防御性兜底）
    for (const key of [candidate.storageKey, candidate.previewStorageKey]) {
      if (key) await removePrivateFile(key);
    }
    deleted += 1;
  }
  return deleted;
}
