import "server-only";

import type { ExternalActor } from "@/lib/external-actor";
import { withExternalActorDb } from "@/lib/external-actor";
import { writeExternalAuditLog } from "@/modules/audit/audit-service";
import {
  createStorageKey,
  readPrivateFile,
  removePrivateFile,
  writePrivateFile,
} from "@/modules/attachments/private-storage";
import { validateAttachmentFile } from "@/modules/attachments/attachment-validation";
import { publishEvent } from "@/modules/notifications/notification-service";
import { scheduleAttachmentPluginJobs } from "@/modules/plugins/plugin-scheduler";
import { DomainError } from "@/modules/projects/errors";

type UploadInput = {
  fileName: string;
  claimedMimeType?: string;
  buffer: Uint8Array;
  serviceRequestId: string;
  requestMessageId?: string;
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
        projectId: true,
        project: { select: { status: true, customerSpaceId: true } },
      },
    });
    if (!request) {
      throw new DomainError("REQUEST_NOT_FOUND", "工单不存在", 404);
    }
    if (request.project.status !== "ACTIVE" || request.status === "CLOSED") {
      throw new DomainError(
        "EXTERNAL_REQUEST_READ_ONLY",
        "当前工单只允许查看历史内容",
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
          projectId: true,
          project: { select: { status: true, customerSpaceId: true } },
        },
      });
      if (!request) {
        throw new DomainError("REQUEST_NOT_FOUND", "工单不存在", 404);
      }
      if (request.project.status !== "ACTIVE" || request.status === "CLOSED") {
        throw new DomainError(
          "EXTERNAL_REQUEST_READ_ONLY",
          "当前工单只允许查看历史内容",
          409,
        );
      }
      const created = await tx.attachment.create({
        data: {
          originalName: normalizeFileName(input.fileName),
          storageKey,
          mimeType: validated.mimeType,
          size: input.buffer.byteLength,
          visibility: "CUSTOMER_VISIBLE",
          customerSpaceId: request.project.customerSpaceId,
          projectId: request.projectId,
          serviceRequestId: request.id,
          requestMessageId: authorized.requestMessageId,
          uploadedByExternalContactId: actor.id,
        },
        select: {
          id: true,
          originalName: true,
          mimeType: true,
          size: true,
          visibility: true,
          serviceRequestId: true,
          requestMessageId: true,
          createdAt: true,
        },
      });
      await writeExternalAuditLog(tx, actor, {
        action: "ATTACHMENT_UPLOADED",
        resourceType: "Attachment",
        resourceId: created.id,
        serviceRequestId: request.id,
        metadata: {
          actorType: "EXTERNAL_CONTACT",
          source: "SUB2API",
          originalName: created.originalName,
          mimeType: created.mimeType,
          size: created.size,
          requestMessageId: created.requestMessageId,
        },
      });
      await publishEvent(tx, {
        type: "REQUEST_UPDATED",
        customerSpaceId: request.project.customerSpaceId,
        projectId: request.projectId,
        serviceRequestId: request.id,
        payload: {
          change: "REQUEST_ATTACHMENT_UPLOADED",
          actorType: "EXTERNAL_CONTACT",
          actorId: actor.id,
          source: "SUB2API",
          requestId: request.id,
          attachmentId: created.id,
          ...(created.requestMessageId
            ? { requestMessageId: created.requestMessageId }
            : {}),
        },
      });
      return created;
    });
  } catch (error) {
    await removePrivateFile(storageKey).catch(() => undefined);
    throw error;
  }
  if (["image/jpeg", "image/png"].includes(attachment.mimeType)) {
    await scheduleAttachmentPluginJobs(attachment.id);
  }
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
        serviceRequest: {
          projectId: actor.projectId,
          createdByExternalContactId: actor.id,
        },
      },
      select: {
        id: true,
        originalName: true,
        storageKey: true,
        mimeType: true,
        size: true,
        serviceRequestId: true,
      },
    });
    if (!attachment) {
      throw new DomainError("ATTACHMENT_NOT_FOUND", "附件不存在", 404);
    }
    const buffer = await readPrivateFile(attachment.storageKey);
    if (!(options?.inlinePreview && attachment.mimeType.startsWith("image/"))) {
      await writeExternalAuditLog(tx, actor, {
        action: "ATTACHMENT_DOWNLOADED",
        resourceType: "Attachment",
        resourceId: attachment.id,
        serviceRequestId: attachment.serviceRequestId ?? undefined,
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
