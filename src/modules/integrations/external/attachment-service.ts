import "server-only";

import type { ExternalActor } from "@/lib/external-actor";
import { withExternalActorDb } from "@/lib/external-actor";
import { extractInlineAttachmentIds } from "@/lib/message-content";
import { parseSupportPlaybookSnapshot } from "@/lib/support-reply-playbooks";
import { writeExternalAuditLog } from "@/modules/audit/audit-service";
import {
  createStorageKey,
  readPrivateFile,
  removePrivateFile,
  writePrivateFile,
} from "@/modules/attachments/private-storage";
import { validateAttachmentFile } from "@/modules/attachments/attachment-validation";
import {
  attachmentRiskText,
  initialPreviewStatus,
  normalizeAttachmentNote,
  normalizeAttachmentTitle,
} from "@/modules/attachments/attachment-meta";
import { queuePreviewRenderIfNeeded } from "@/modules/attachments/attachment-service";
import { dispatchExternalRequestActivity } from "@/modules/notifications/notification-service";
import { scheduleAttachmentPluginJobs } from "@/modules/plugins/plugin-scheduler";
import { DomainError } from "@/modules/projects/errors";
import {
  createContentRiskReview,
  enforceExternalPublicContentRules,
  isContentRiskAttachmentRevoked,
} from "@/modules/plugins/content-risk-service";

type UploadInput = {
  fileName: string;
  claimedMimeType?: string;
  buffer: Uint8Array;
  serviceRequestId: string;
  requestMessageId?: string;
  inline?: boolean;
  title?: string;
  note?: string;
};

function normalizeFileName(fileName: string) {
  const normalized = fileName
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .replace(/[\\/]/g, "_")
    .trim();
  return normalized.slice(0, 255) || "attachment";
}

export async function uploadExternalAttachment(
  actor: ExternalActor,
  input: UploadInput,
  options: { customerMemberNotificationsEnabled: boolean },
) {
  // Authorize first so untrusted callers cannot force disk IO / CPU validation
  // against arbitrary request IDs.
  const authorized = await withExternalActorDb(actor, async (tx) => {
    const request = await tx.serviceRequest.findFirst({
      where: {
        id: input.serviceRequestId,
        projectId: actor.projectId,
        createdByExternalContactId: actor.id,
      },
      select: {
        id: true,
        status: true,
        archivedAt: true,
        assigneeId: true,
        assignees: { select: { userId: true } },
        projectId: true,
        project: { select: { status: true, customerSpaceId: true } },
      },
    });
    if (!request) {
      throw new DomainError("REQUEST_NOT_FOUND", "服务请求不存在", 404);
    }
    if (
      request.project.status !== "ACTIVE" ||
      request.status === "CLOSED" ||
      request.archivedAt
    ) {
      throw new DomainError(
        "EXTERNAL_REQUEST_READ_ONLY",
        "当前服务请求只允许查看历史内容",
        409,
      );
    }
    let requestMessageId: string | undefined;
    if (input.requestMessageId) {
      const message = await tx.requestMessage.findFirst({
        where: {
          id: input.requestMessageId,
          serviceRequestId: request.id,
          visibility: "CUSTOMER_VISIBLE",
          OR: [
            { externalAuthorId: actor.id },
            {
              isInitial: true,
              serviceRequest: { createdByExternalContactId: actor.id },
            },
          ],
        },
        select: { id: true },
      });
      if (!message) {
        throw new DomainError(
          "REQUEST_MESSAGE_NOT_FOUND",
          "消息不存在或不能关联附件",
          404,
        );
      }
      requestMessageId = message.id;
    }
    return {
      request,
      requestMessageId,
    };
  });

  const validated = await validateAttachmentFile(
    input.buffer,
    input.claimedMimeType,
    input.fileName,
  );
  if (input.inline && !validated.mimeType.startsWith("image/")) {
    throw new DomainError(
      "INLINE_IMAGE_REQUIRED",
      "正文中只能插入图片文件",
      422,
    );
  }
  const title = normalizeAttachmentTitle(input.title);
  const note = normalizeAttachmentNote(input.note);
  await enforceExternalPublicContentRules(actor, {
    targetType: "ATTACHMENT",
    customerSpaceId: authorized.request.project.customerSpaceId,
    projectId: authorized.request.projectId,
    serviceRequestId: authorized.request.id,
    snapshot: {
      body: attachmentRiskText(input.fileName, title, note),
      visibility: "CUSTOMER_VISIBLE",
    },
  });
  const storageKey = createStorageKey(
    input.serviceRequestId,
    validated.extension,
  );
  await writePrivateFile(storageKey, input.buffer);

  let attachment;
  try {
    attachment = await withExternalActorDb(actor, async (tx) => {
      // Re-check request still writable after validation cost.
      const request = await tx.serviceRequest.findFirst({
        where: {
          id: authorized.request.id,
          projectId: actor.projectId,
          createdByExternalContactId: actor.id,
        },
        select: {
          id: true,
          status: true,
          archivedAt: true,
          assigneeId: true,
          assignees: { select: { userId: true } },
          projectId: true,
          project: { select: { status: true, customerSpaceId: true } },
        },
      });
      if (!request) {
        throw new DomainError("REQUEST_NOT_FOUND", "服务请求不存在", 404);
      }
      if (
        request.project.status !== "ACTIVE" ||
        request.status === "CLOSED" ||
        request.archivedAt
      ) {
        throw new DomainError(
          "EXTERNAL_REQUEST_READ_ONLY",
          "当前服务请求只允许查看历史内容",
          409,
        );
      }
      const created = await tx.attachment.create({
        data: {
          originalName: normalizeFileName(input.fileName),
          title,
          note,
          storageKey,
          previewStatus: initialPreviewStatus(validated.mimeType),
          mimeType: validated.mimeType,
          size: input.buffer.byteLength,
          visibility: "CUSTOMER_VISIBLE",
          inline: input.inline === true,
          customerSpaceId: request.project.customerSpaceId,
          projectId: request.projectId,
          serviceRequestId: request.id,
          requestMessageId: authorized.requestMessageId,
          uploadedByExternalContactId: actor.id,
        },
        select: {
          id: true,
          originalName: true,
          title: true,
          note: true,
          mimeType: true,
          size: true,
          visibility: true,
          serviceRequestId: true,
          requestMessageId: true,
          createdAt: true,
        },
      });
      await writeExternalAuditLog(tx, actor, {
        action: input.inline ? "INLINE_IMAGE_UPLOADED" : "ATTACHMENT_UPLOADED",
        resourceType: "Attachment",
        resourceId: created.id,
        serviceRequestId: request.id,
        metadata: {
          actorType: "EXTERNAL_CONTACT",
          source: actor.sourceKey ?? "sub2api-connector",
          originalName: created.originalName,
          mimeType: created.mimeType,
          size: created.size,
          requestMessageId: created.requestMessageId,
        },
      });
      const contentRiskReview = await createContentRiskReview(tx, {
        targetType: "ATTACHMENT",
        targetId: created.id,
        actorId: actor.id,
        actorName: actor.name,
        actorKind: "EXTERNAL",
        isPlatformAdmin: false,
        customerSpaceId: request.project.customerSpaceId,
        projectId: request.projectId,
        serviceRequestId: request.id,
        snapshot: {
          body: attachmentRiskText(
            created.originalName,
            created.title,
            created.note,
          ),
          visibility: "CUSTOMER_VISIBLE",
          attachmentIds: [created.id],
        },
      });
      if (!input.inline) {
        const workers = Array.from(
          new Set(
            [
              request.assigneeId,
              ...request.assignees.map((item) => item.userId),
            ].filter((value): value is string => Boolean(value)),
          ),
        );
        const linkedToMessage = Boolean(created.requestMessageId);
        await dispatchExternalRequestActivity(tx, actor, {
          eventType: "REQUEST_UPDATED",
          eventPayload: {
            change: "REQUEST_ATTACHMENT_UPLOADED",
            actorType: "EXTERNAL_CONTACT",
            actorId: actor.id,
            source: actor.sourceKey ?? "sub2api-connector",
            requestId: request.id,
            attachmentId: created.id,
            visibility: "CUSTOMER_VISIBLE",
            ...(created.requestMessageId
              ? { requestMessageId: created.requestMessageId }
              : {}),
          },
          notificationType: "REQUEST_ATTACHMENT",
          notificationTitle: `${actor.name} 上传了服务请求附件`,
          notificationBody: created.title ?? created.originalName,
          includeCustomers: options.customerMemberNotificationsEnabled,
          relevantWorkerUserIds: workers,
          notifyProjectManagers: true,
          notifyPlatformAdmins: true,
          createNotifications: !linkedToMessage,
          audible: !linkedToMessage,
          customerSpaceId: request.project.customerSpaceId,
          projectId: request.projectId,
          serviceRequestId: request.id,
          contentRiskReviewId: contentRiskReview?.id,
        });
      }
      return created;
    });
  } catch (error) {
    await removePrivateFile(storageKey).catch(() => undefined);
    throw error;
  }
  if (["image/jpeg", "image/png"].includes(attachment.mimeType)) {
    await scheduleAttachmentPluginJobs(attachment.id);
  }
  await queuePreviewRenderIfNeeded(attachment.id, attachment.mimeType);
  return attachment;
}

export function readExternalAttachment(
  actor: ExternalActor,
  attachmentId: string,
  options?: { inlinePreview?: boolean },
) {
  return withExternalActorDb(actor, async (tx) => {
    const attachment = await tx.attachment.findFirst({
      where: {
        id: attachmentId,
        visibility: "CUSTOMER_VISIBLE",
      },
      select: {
        id: true,
        originalName: true,
        storageKey: true,
        mimeType: true,
        size: true,
        serviceRequestId: true,
        requestMessageId: true,
        projectUpdateId: true,
        updateCommentId: true,
        milestoneId: true,
        supportPlaybookKey: true,
      },
    });
    if (!attachment) {
      throw new DomainError("ATTACHMENT_NOT_FOUND", "附件不存在", 404);
    }
    if (await isContentRiskAttachmentRevoked(tx, attachment)) {
      throw new DomainError("ATTACHMENT_REVOKED", "该附件已被撤回", 404);
    }
    const normalRequest = attachment.serviceRequestId
      ? await tx.serviceRequest.findFirst({
          where: {
            id: attachment.serviceRequestId,
            projectId: actor.projectId,
            createdByExternalContactId: actor.id,
          },
          select: { id: true },
        })
      : null;
    const playbookMessages = attachment.supportPlaybookKey
      ? await tx.requestMessage.findMany({
          where: {
            supportPlaybookKey: attachment.supportPlaybookKey,
            visibility: "CUSTOMER_VISIBLE",
            serviceRequest: {
              projectId: actor.projectId,
              createdByExternalContactId: actor.id,
            },
          },
          select: {
            serviceRequestId: true,
            supportPlaybookSnapshot: true,
          },
        })
      : [];
    const playbookMessage = playbookMessages.find((message) => {
      const snapshot = parseSupportPlaybookSnapshot(
        message.supportPlaybookSnapshot,
      );
      return Boolean(
        snapshot?.content &&
          extractInlineAttachmentIds(snapshot.content).includes(attachment.id),
      );
    });
    if (!normalRequest && !playbookMessage) {
      throw new DomainError("ATTACHMENT_NOT_FOUND", "附件不存在", 404);
    }
    const buffer = await readPrivateFile(attachment.storageKey);
    if (!(options?.inlinePreview && attachment.mimeType.startsWith("image/"))) {
      await writeExternalAuditLog(tx, actor, {
        action: "ATTACHMENT_DOWNLOADED",
        resourceType: "Attachment",
        resourceId: attachment.id,
        serviceRequestId:
          attachment.serviceRequestId ?? playbookMessage?.serviceRequestId,
        metadata: {
          actorType: "EXTERNAL_CONTACT",
          originalName: attachment.originalName,
          size: attachment.size,
        },
      });
    }
    return { attachment, buffer };
  });
}
