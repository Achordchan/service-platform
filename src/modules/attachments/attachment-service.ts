import "server-only";

import type {
  ContentVisibility,
  Prisma,
} from "@/generated/prisma/client";
import type { Actor } from "@/lib/actor";
import { withActorDb } from "@/lib/actor";
import { writeAuditLog } from "@/modules/audit/audit-service";
import {
  publishProjectChange,
  publishRequestChange,
} from "@/modules/notifications/notification-service";
import {
  createStorageKey,
  createProjectStorageKey,
  readPrivateFile,
  removePrivateFile,
  writePrivateFile,
} from "@/modules/attachments/private-storage";
import {
  getAttachmentPolicy,
  validateAttachmentFile,
} from "@/modules/attachments/attachment-validation";
import { assertCanManageProjectDelivery } from "@/modules/projects/project-access";
import {
  conflict,
  forbidden,
  notFound,
} from "@/modules/requests/errors";
import {
  findRequestContext,
  getProjectRole,
} from "@/modules/requests/request-context";
import {
  canWorkOnRequest,
  canWriteInternalNote,
} from "@/modules/requests/request-permissions";

export type UploadAttachmentInput = {
  fileName: string;
  claimedMimeType?: string;
  buffer: Uint8Array;
  serviceRequestId: string;
  requestMessageId?: string;
  visibility?: ContentVisibility;
};

export async function uploadRequestAttachment(
  actor: Actor,
  input: UploadAttachmentInput,
) {
  if (!actor.isStaff && input.requestMessageId) {
    const policy = await getAttachmentPolicy();
    if (!policy.customerReplyAttachmentsEnabled) {
      throw forbidden("当前未开放客户在回复中上传附件");
    }
  }

  const validated = await validateAttachmentFile(
    input.buffer,
    input.claimedMimeType,
    input.fileName,
  );
  await authorizeUpload(actor, input);
  const storageKey = createStorageKey(
    input.serviceRequestId,
    validated.extension,
  );

  await writePrivateFile(storageKey, input.buffer);
  try {
    return await withActorDb(actor, async (tx) => {
      const context = await authorizeUploadInTx(tx, actor, input);
      const { request } = context;

      const attachment = await tx.attachment.create({
        data: {
          originalName: normalizeFileName(input.fileName),
          storageKey,
          mimeType: validated.mimeType,
          size: input.buffer.byteLength,
          visibility: context.visibility,
          customerSpaceId: request.project.customerSpaceId,
          projectId: request.projectId,
          serviceRequestId: request.id,
          requestMessageId: context.requestMessageId,
          uploadedById: actor.id,
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

      await writeAuditLog(tx, actor, {
        action: "ATTACHMENT_UPLOADED",
        resourceType: "Attachment",
        resourceId: attachment.id,
        customerSpaceId: request.project.customerSpaceId,
        projectId: request.projectId,
        serviceRequestId: request.id,
        metadata: {
          originalName: attachment.originalName,
          mimeType: attachment.mimeType,
          size: attachment.size,
          visibility: attachment.visibility,
          requestMessageId: attachment.requestMessageId,
        },
      });
      await publishRequestChange(tx, actor, {
        change: "REQUEST_ATTACHMENT_UPLOADED",
        customerSpaceId: request.project.customerSpaceId,
        projectId: request.projectId,
        serviceRequestId: request.id,
        visibility: attachment.visibility,
        payload: {
          attachmentId: attachment.id,
          ...(attachment.requestMessageId
            ? { requestMessageId: attachment.requestMessageId }
            : {}),
        },
      });

      return attachment;
    });
  } catch (error) {
    await removePrivateFile(storageKey);
    throw error;
  }
}

export type UploadProjectAttachmentInput = {
  fileName: string;
  claimedMimeType?: string;
  buffer: Uint8Array;
  projectId: string;
  visibility?: ContentVisibility;
};

export async function uploadProjectAttachment(
  actor: Actor,
  input: UploadProjectAttachmentInput,
) {
  const validated = await validateAttachmentFile(
    input.buffer,
    input.claimedMimeType,
    input.fileName,
  );
  const visibility = input.visibility ?? "CUSTOMER_VISIBLE";
  const storageKey = createProjectStorageKey(
    input.projectId,
    validated.extension,
  );

  await writePrivateFile(storageKey, input.buffer);
  try {
    return await withActorDb(actor, async (tx) => {
      const project = await assertCanManageProjectDelivery(
        tx,
        actor,
        input.projectId,
      );
      const attachment = await tx.attachment.create({
        data: {
          originalName: normalizeFileName(input.fileName),
          storageKey,
          mimeType: validated.mimeType,
          size: input.buffer.byteLength,
          visibility,
          customerSpaceId: project.customerSpaceId,
          projectId: project.projectId,
          uploadedById: actor.id,
        },
        select: {
          id: true,
          originalName: true,
          mimeType: true,
          size: true,
          visibility: true,
          projectId: true,
          createdAt: true,
        },
      });

      await writeAuditLog(tx, actor, {
        action: "PROJECT_ATTACHMENT_UPLOADED",
        resourceType: "Attachment",
        resourceId: attachment.id,
        customerSpaceId: project.customerSpaceId,
        projectId: project.projectId,
        metadata: {
          originalName: attachment.originalName,
          mimeType: attachment.mimeType,
          size: attachment.size,
          visibility: attachment.visibility,
        },
      });
      await publishProjectChange(tx, actor, {
        change: "PROJECT_ATTACHMENT_UPLOADED",
        customerSpaceId: project.customerSpaceId,
        projectId: project.projectId,
        visibility: attachment.visibility,
        payload: { attachmentId: attachment.id },
      });
      return attachment;
    });
  } catch (error) {
    await removePrivateFile(storageKey);
    throw error;
  }
}

export function readAttachmentDownload(
  actor: Actor,
  attachmentId: string,
) {
  return withActorDb(actor, async (tx) => {
    const attachment = await tx.attachment.findUnique({
      where: { id: attachmentId },
      select: {
        id: true,
        originalName: true,
        storageKey: true,
        mimeType: true,
        size: true,
        visibility: true,
        customerSpaceId: true,
        projectId: true,
        serviceRequestId: true,
      },
    });
    if (!attachment) {
      throw notFound("附件不存在或无权访问");
    }
    if (attachment.visibility === "INTERNAL" && !actor.isStaff) {
      throw notFound("附件不存在或无权访问");
    }

    const buffer = await readPrivateFile(attachment.storageKey);
    await writeAuditLog(tx, actor, {
      action: "ATTACHMENT_DOWNLOADED",
      resourceType: "Attachment",
      resourceId: attachment.id,
      customerSpaceId: attachment.customerSpaceId,
      projectId: attachment.projectId ?? undefined,
      serviceRequestId: attachment.serviceRequestId ?? undefined,
      metadata: {
        originalName: attachment.originalName,
        size: attachment.size,
      },
    });

    return { attachment, buffer };
  });
}

async function authorizeUpload(
  actor: Actor,
  input: UploadAttachmentInput,
) {
  return withActorDb(actor, (tx) =>
    authorizeUploadInTx(tx, actor, input),
  );
}

async function authorizeUploadInTx(
  tx: Prisma.TransactionClient,
  actor: Actor,
  input: UploadAttachmentInput,
) {
  const request = await findRequestContext(
    tx,
    input.serviceRequestId,
    actor.id,
  );
  if (!request) throw notFound();
  if (request.status === "CLOSED") {
    throw conflict("REQUEST_CLOSED", "已关闭的请求不能上传附件");
  }

  const requestAccess = {
    assigneeId: request.assigneeId,
    assigneeIds: request.assignees.map((item) => item.userId),
    projectRole: getProjectRole(request),
  };
  const isCustomer = actor.platformRole === "CUSTOMER";
  if (!isCustomer && !canWorkOnRequest(actor, requestAccess)) {
    throw forbidden("只有请求处理人员或客户可以上传附件");
  }

  if (input.requestMessageId) {
    const message = await tx.requestMessage.findFirst({
      where: {
        id: input.requestMessageId,
        serviceRequestId: request.id,
      },
      select: { id: true, visibility: true },
    });
    if (!message) {
      throw notFound("请求消息不存在");
    }
    if (message.visibility === "INTERNAL") {
      if (!canWriteInternalNote(actor, requestAccess)) {
        throw forbidden("无权为内部备注上传附件");
      }
    } else if (input.visibility === "INTERNAL") {
      throw conflict(
        "ATTACHMENT_VISIBILITY_MISMATCH",
        "客户可见消息不能包含内部附件",
      );
    }
    return {
      request,
      requestMessageId: message.id,
      visibility: message.visibility,
    };
  }

  const visibility = input.visibility ?? "CUSTOMER_VISIBLE";
  if (
    visibility === "INTERNAL" &&
    !canWriteInternalNote(actor, requestAccess)
  ) {
    throw forbidden("只有请求处理人员可以上传内部附件");
  }
  return { request, requestMessageId: undefined, visibility };
}

function normalizeFileName(fileName: string) {
  const normalized = fileName
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .replace(/[\\/]/g, "_")
    .trim();
  return normalized.slice(0, 255) || "attachment";
}
