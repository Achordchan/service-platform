import "server-only";

import type {
  ContentVisibility,
  Prisma,
} from "@/generated/prisma/client";
import type { Actor } from "@/lib/actor";
import { withActorDb } from "@/lib/actor";
import { hasRolePermission } from "@/modules/authorization/role-permission-policy";
import { extractInlineAttachmentIds } from "@/lib/message-content";
import { parseSupportPlaybookSnapshot } from "@/lib/support-reply-playbooks";
import { writeAuditLog } from "@/modules/audit/audit-service";
import {
  dispatchProjectActivity,
  dispatchRequestActivity,
} from "@/modules/notifications/notification-service";
import {
  createStorageKey,
  createProjectStorageKey,
  createSupportPlaybookStorageKey,
  readPrivateFile,
  removePrivateFile,
  writePrivateFile,
} from "@/modules/attachments/private-storage";
import {
  getAttachmentPolicy,
  validateAttachmentFile,
} from "@/modules/attachments/attachment-validation";
import {
  attachmentRiskText,
  isOfficePreviewMimeType,
  normalizeAttachmentNote,
  normalizeAttachmentTitle,
} from "@/modules/attachments/attachment-meta";
import { initialPreviewStatus } from "@/modules/attachments/preview-render-service";
import { queueAttachmentPreviewRender } from "@/lib/jobs";
import {
  assertCanManageActiveProjectDelivery,
  assertCanPublishActiveProjectUpdate,
  assertCanUploadActiveProjectFile,
  assertCanViewCustomerProjectFeature,
} from "@/modules/projects/project-access";
import {
  badRequest,
  conflict,
  forbidden,
  notFound,
} from "@/modules/requests/errors";
import {
  canAccessCustomerRequestModule,
  findRequestContext,
  getProjectRole,
} from "@/modules/requests/request-context";
import {
  canAttachToRequestMessage,
  canUploadRequestFile,
  canWriteInternalNote,
} from "@/modules/requests/request-permissions";
import { scheduleAttachmentPluginJobs } from "@/modules/plugins/plugin-scheduler";
import {
  createContentRiskReview,
  enforceActorPublicContentRules,
  isContentRiskAttachmentRevoked,
} from "@/modules/plugins/content-risk-service";

export type UploadAttachmentInput = {
  fileName: string;
  claimedMimeType?: string;
  buffer: Uint8Array;
  serviceRequestId: string;
  requestMessageId?: string;
  visibility?: ContentVisibility;
  inline?: boolean;
  title?: string;
  note?: string;
};

export type UploadSupportPlaybookImageInput = {
  fileName: string;
  claimedMimeType?: string;
  buffer: Uint8Array;
};

export async function uploadSupportPlaybookImage(
  actor: Actor,
  input: UploadSupportPlaybookImageInput,
) {
  if (!actor.isPlatformAdmin) {
    throw forbidden("只有平台管理员可以上传回复指南图片");
  }
  const validated = await validateAttachmentFile(
    input.buffer,
    input.claimedMimeType,
    input.fileName,
  );
  if (!validated.mimeType.startsWith("image/")) {
    throw badRequest("INLINE_IMAGE_REQUIRED", "指南正文中只能插入图片文件");
  }
  const storageKey = createSupportPlaybookStorageKey(validated.extension);
  await writePrivateFile(storageKey, input.buffer);
  let attachment;
  try {
    attachment = await withActorDb(actor, async (tx) => {
      const created = await tx.attachment.create({
        data: {
          originalName: normalizeFileName(input.fileName),
          storageKey,
          mimeType: validated.mimeType,
          size: input.buffer.byteLength,
          visibility: "CUSTOMER_VISIBLE",
          inline: true,
          customerSpaceId: null,
          uploadedById: actor.id,
        },
        select: {
          id: true,
          originalName: true,
          mimeType: true,
          size: true,
          createdAt: true,
        },
      });
      await writeAuditLog(tx, actor, {
        action: "SUPPORT_PLAYBOOK_IMAGE_UPLOADED",
        resourceType: "Attachment",
        resourceId: created.id,
        metadata: {
          originalName: created.originalName,
          mimeType: created.mimeType,
          size: created.size,
        },
      });
      return created;
    });
  } catch (error) {
    await removePrivateFile(storageKey);
    throw error;
  }
  if (["image/jpeg", "image/png"].includes(attachment.mimeType)) {
    await scheduleAttachmentPluginJobs(attachment.id);
  }
  return attachment;
}

export async function uploadRequestAttachment(
  actor: Actor,
  input: UploadAttachmentInput,
) {
  const validated = await validateAttachmentFile(
    input.buffer,
    input.claimedMimeType,
    input.fileName,
  );
  if (input.inline && !validated.mimeType.startsWith("image/")) {
    throw badRequest("INLINE_IMAGE_REQUIRED", "正文中只能插入图片文件");
  }
  const title = normalizeAttachmentTitle(input.title);
  const note = normalizeAttachmentNote(input.note);
  await authorizeUpload(actor, input);
  if ((input.visibility ?? "CUSTOMER_VISIBLE") === "CUSTOMER_VISIBLE") {
    await enforceActorPublicContentRules(actor, {
      targetType: "ATTACHMENT",
      customerSpaceId: null,
      projectId: null,
      serviceRequestId: input.serviceRequestId,
      snapshot: {
        body: attachmentRiskText(input.fileName, title, note),
        visibility: "CUSTOMER_VISIBLE",
      },
    });
  }
  const storageKey = createStorageKey(
    input.serviceRequestId,
    validated.extension,
  );

  await writePrivateFile(storageKey, input.buffer);
  let attachment;
  try {
    attachment = await withActorDb(actor, async (tx) => {
      const context = await authorizeUploadInTx(tx, actor, input);
      const { request } = context;

      const attachment = await tx.attachment.create({
        data: {
          originalName: normalizeFileName(input.fileName),
          title,
          note,
          storageKey,
          previewStatus: initialPreviewStatus(validated.mimeType),
          mimeType: validated.mimeType,
          size: input.buffer.byteLength,
          visibility: context.visibility,
          inline: input.inline === true,
          customerSpaceId: request.project.customerSpaceId,
          projectId: request.projectId,
          serviceRequestId: request.id,
          requestMessageId: context.requestMessageId,
          uploadedById: actor.id,
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
          serviceRequestId: true,
          requestMessageId: true,
          createdAt: true,
        },
      });

      await writeAuditLog(tx, actor, {
        action: input.inline ? "INLINE_IMAGE_UPLOADED" : "ATTACHMENT_UPLOADED",
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
      const contentRiskReview = await createContentRiskReview(tx, {
        targetType: "ATTACHMENT",
        targetId: attachment.id,
        actorId: actor.id,
        actorName: actor.name,
        actorKind: actor.platformRole === "CUSTOMER" ? "CUSTOMER" : "STAFF",
        isPlatformAdmin: actor.isPlatformAdmin,
        customerSpaceId: request.project.customerSpaceId,
        projectId: request.projectId,
        serviceRequestId: request.id,
        snapshot: {
          body: attachmentRiskText(
            attachment.originalName,
            attachment.title,
            attachment.note,
          ),
          visibility: attachment.visibility,
          attachmentIds: [attachment.id],
        },
      });
      let deliveryFeedback = null;
      if (!input.inline) {
        const workerIds = Array.from(
          new Set(
            [
              request.assigneeId,
              ...request.assignees.map((item) => item.userId),
            ].filter((value): value is string => Boolean(value)),
          ),
        );
        const internal = attachment.visibility === "INTERNAL";
        const delivery = await dispatchRequestActivity(tx, actor, {
          eventType: "REQUEST_UPDATED",
          eventPayload: {
            change: "REQUEST_ATTACHMENT_UPLOADED",
            actorId: actor.id,
            requestId: request.id,
            attachmentId: attachment.id,
            visibility: attachment.visibility,
          },
          notificationType: "REQUEST_ATTACHMENT",
          notificationTitle: internal
            ? `${actor.name} 上传了内部附件`
            : `${actor.name} 上传了服务请求附件`,
          notificationBody: attachment.title ?? attachment.originalName,
          includeCustomers:
            !internal && includeCustomerMembersForRequest(request),
          includeExternalContact:
            !internal && Boolean(request.createdByExternalContactId),
          relevantWorkerUserIds: workerIds,
          notifyProjectManagers: internal || workerIds.length === 0,
          notifyPlatformAdmins: !internal && workerIds.length === 0,
          customerSpaceId: request.project.customerSpaceId,
          projectId: request.projectId,
          serviceRequestId: request.id,
          contentRiskReviewId: contentRiskReview?.id,
        });
        deliveryFeedback = delivery.feedback;
      }
      return { ...attachment, deliveryFeedback };
    });
  } catch (error) {
    await removePrivateFile(storageKey);
    throw error;
  }
  if (["image/jpeg", "image/png"].includes(attachment.mimeType)) {
    await scheduleAttachmentPluginJobs(attachment.id);
  }
  await queuePreviewRenderIfNeeded(attachment.id, attachment.mimeType);
  return attachment;
}

export type UploadProjectAttachmentInput = {
  fileName: string;
  claimedMimeType?: string;
  buffer: Uint8Array;
  projectId: string;
  visibility?: ContentVisibility;
  inlineContext?: "REQUEST_DESCRIPTION" | "PROJECT_UPDATE" | "MILESTONE";
  title?: string;
  note?: string;
};

export async function uploadProjectAttachment(
  actor: Actor,
  input: UploadProjectAttachmentInput,
) {
  await withActorDb(actor, (tx) =>
    authorizeProjectAttachmentUpload(tx, actor, input),
  );
  const validated = await validateAttachmentFile(
    input.buffer,
    input.claimedMimeType,
    input.fileName,
  );
  if (input.inlineContext && !validated.mimeType.startsWith("image/")) {
    throw badRequest("INLINE_IMAGE_REQUIRED", "正文中只能插入图片文件");
  }
  const title = normalizeAttachmentTitle(input.title);
  const note = normalizeAttachmentNote(input.note);
  const visibility = input.visibility ?? "CUSTOMER_VISIBLE";
  if (visibility === "CUSTOMER_VISIBLE") {
    await enforceActorPublicContentRules(actor, {
      targetType: "ATTACHMENT",
      customerSpaceId: null,
      projectId: input.projectId,
      serviceRequestId: null,
      snapshot: {
        body: attachmentRiskText(input.fileName, title, note),
        visibility,
      },
    });
  }
  const storageKey = createProjectStorageKey(
    input.projectId,
    validated.extension,
  );

  await writePrivateFile(storageKey, input.buffer);
  let attachment;
  try {
    attachment = await withActorDb(actor, async (tx) => {
      const project = await authorizeProjectAttachmentUpload(
        tx,
        actor,
        input,
      );
      const attachment = await tx.attachment.create({
        data: {
          originalName: normalizeFileName(input.fileName),
          title,
          note,
          storageKey,
          previewStatus: initialPreviewStatus(validated.mimeType),
          mimeType: validated.mimeType,
          size: input.buffer.byteLength,
          visibility,
          inline: Boolean(input.inlineContext),
          customerSpaceId: project.customerSpaceId,
          projectId: project.projectId,
          uploadedById: actor.id,
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
          projectId: true,
          createdAt: true,
        },
      });

      await writeAuditLog(tx, actor, {
        action: input.inlineContext
          ? "INLINE_IMAGE_UPLOADED"
          : "PROJECT_ATTACHMENT_UPLOADED",
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
      const contentRiskReview = await createContentRiskReview(tx, {
        targetType: "ATTACHMENT",
        targetId: attachment.id,
        actorId: actor.id,
        actorName: actor.name,
        actorKind: actor.platformRole === "CUSTOMER" ? "CUSTOMER" : "STAFF",
        isPlatformAdmin: actor.isPlatformAdmin,
        customerSpaceId: project.customerSpaceId,
        projectId: project.projectId,
        serviceRequestId: null,
        snapshot: {
          body: attachmentRiskText(
            attachment.originalName,
            attachment.title,
            attachment.note,
          ),
          visibility: attachment.visibility,
          attachmentIds: [attachment.id],
        },
      });
      let deliveryFeedback = null;
      if (!input.inlineContext) {
        const delivery = await dispatchProjectActivity(tx, actor, {
          eventType: "PROJECT_UPDATED",
          eventPayload: {
            change: "PROJECT_ATTACHMENT_UPLOADED",
            actorId: actor.id,
            projectId: project.projectId,
            attachmentId: attachment.id,
          },
          notificationType: "PROJECT_FILE",
          notificationTitle: "项目新增文件",
          notificationBody: attachment.title ?? attachment.originalName,
          visibility: attachment.visibility,
          customerSpaceId: project.customerSpaceId,
          projectId: project.projectId,
          contentRiskReviewId: contentRiskReview?.id,
        });
        deliveryFeedback = delivery.feedback;
      }
      return { ...attachment, deliveryFeedback };
    });
  } catch (error) {
    await removePrivateFile(storageKey);
    throw error;
  }
  if (["image/jpeg", "image/png"].includes(attachment.mimeType)) {
    await scheduleAttachmentPluginJobs(attachment.id);
  }
  await queuePreviewRenderIfNeeded(attachment.id, attachment.mimeType);
  return attachment;
}

// 预览件生成是尽力而为：入队失败只记日志，不影响上传结果
async function queuePreviewRenderIfNeeded(
  attachmentId: string,
  mimeType: string,
) {
  if (!isOfficePreviewMimeType(mimeType)) return;
  try {
    await queueAttachmentPreviewRender(attachmentId);
  } catch (error) {
    console.error(
      "ACHORD_ATTACHMENT_PREVIEW_ENQUEUE_FAILED",
      JSON.stringify({
        event: "attachment.preview_enqueue_failed",
        attachmentId,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  }
}

export function readAttachmentDownload(
  actor: Actor,
  attachmentId: string,
  options?: { inlinePreview?: boolean; variant?: "preview" },
) {
  return withActorDb(actor, async (tx) => {
    const attachment = await tx.attachment.findUnique({
      where: { id: attachmentId },
      select: {
        id: true,
        originalName: true,
        title: true,
        storageKey: true,
        previewStorageKey: true,
        previewStatus: true,
        mimeType: true,
        size: true,
        visibility: true,
        inline: true,
        customerSpaceId: true,
        projectId: true,
        projectUpdateId: true,
        updateCommentId: true,
        milestoneId: true,
        supportPlaybookKey: true,
        serviceRequestId: true,
        requestMessageId: true,
        uploadedById: true,
      },
    });
    if (!attachment) {
      throw notFound("附件不存在或无权访问");
    }
    if (
      !actor.isPlatformAdmin &&
      (await isContentRiskAttachmentRevoked(tx, attachment))
    ) {
      throw notFound("附件已被撤回");
    }
    if (attachment.visibility === "INTERNAL" && !actor.isStaff) {
      throw notFound("附件不存在或无权访问");
    }
    if (attachment.supportPlaybookKey && !actor.isStaff) {
      const messages = await tx.requestMessage.findMany({
        where: {
          supportPlaybookKey: attachment.supportPlaybookKey,
          visibility: "CUSTOMER_VISIBLE",
        },
        select: {
          supportPlaybookSnapshot: true,
          serviceRequest: {
            select: {
              project: { select: { customerRequestsEnabled: true } },
            },
          },
        },
      });
      const referenced = messages.some((message) => {
        const snapshot = parseSupportPlaybookSnapshot(
          message.supportPlaybookSnapshot,
        );
        return Boolean(
          message.serviceRequest.project.customerRequestsEnabled &&
          snapshot?.content &&
            extractInlineAttachmentIds(snapshot.content).includes(attachment.id),
        );
      });
      if (!referenced) throw notFound("附件不存在或无权访问");
    }
    if (
      attachment.inline &&
      !attachment.serviceRequestId &&
      !attachment.projectUpdateId &&
      !attachment.milestoneId &&
      !attachment.supportPlaybookKey &&
      attachment.uploadedById !== actor.id
    ) {
      throw notFound("附件不存在或无权访问");
    }
    if (!actor.isStaff && attachment.projectId) {
      const project = await tx.project.findUnique({
        where: { id: attachment.projectId },
        select: {
          customerRequestsEnabled: true,
          customerUpdatesEnabled: true,
          customerFilesEnabled: true,
          showMilestones: true,
        },
      });
      const featureEnabled = attachment.serviceRequestId
        ? project?.customerRequestsEnabled
        : attachment.projectUpdateId || attachment.updateCommentId
          ? project?.customerUpdatesEnabled
          : attachment.milestoneId
            ? project?.showMilestones
            : project?.customerFilesEnabled;
      if (!project || !featureEnabled) {
        throw notFound("附件不存在或无权访问");
      }
    }

    // variant=preview：读 Office 附件的派生 PDF 预览件（授权判定与原文件完全一致）
    const usePreview = options?.variant === "preview";
    if (
      usePreview &&
      (!attachment.previewStorageKey || attachment.previewStatus !== "READY")
    ) {
      throw notFound("该附件暂无可用预览");
    }
    const buffer = await readPrivateFile(
      usePreview && attachment.previewStorageKey
        ? attachment.previewStorageKey
        : attachment.storageKey,
    );
    const isInlineImagePreview =
      options?.inlinePreview === true &&
      attachment.mimeType.startsWith("image/");
    if (!isInlineImagePreview) {
      await writeAuditLog(tx, actor, {
        action: "ATTACHMENT_DOWNLOADED",
        resourceType: "Attachment",
        resourceId: attachment.id,
        customerSpaceId: attachment.customerSpaceId ?? undefined,
        projectId: attachment.projectId ?? undefined,
        serviceRequestId: attachment.serviceRequestId ?? undefined,
        metadata: {
          originalName: attachment.originalName,
          size: attachment.size,
        },
      });
    }

    return { attachment, buffer };
  });
}

async function authorizeProjectAttachmentUpload(
  tx: Prisma.TransactionClient,
  actor: Actor,
  input: UploadProjectAttachmentInput,
) {
  if (input.inlineContext === "REQUEST_DESCRIPTION") {
    const context = await assertCanViewCustomerProjectFeature(
      tx,
      actor,
      input.projectId,
      "requests",
    );
    const project = await tx.project.findUnique({
      where: { id: input.projectId },
      select: { status: true },
    });
    if (!project || project.status !== "ACTIVE") {
      throw conflict(
        "PROJECT_NOT_ACTIVE",
        "只有进行中的项目可以插入正文图片",
      );
    }
    if (actor.isStaff && !hasRolePermission(actor, "file.upload")) {
      throw forbidden("当前角色无权上传文件");
    }
    return {
      projectId: context.projectId,
      customerSpaceId: context.customerSpaceId,
    };
  }
  const context = input.inlineContext
    ? input.inlineContext === "PROJECT_UPDATE"
      ? await assertCanPublishActiveProjectUpdate(tx, actor, input.projectId)
      : await assertCanManageActiveProjectDelivery(tx, actor, input.projectId)
    : await assertCanUploadActiveProjectFile(tx, actor, input.projectId);
  if (!hasRolePermission(actor, "file.upload")) {
    throw forbidden("当前角色无权上传文件");
  }
  return context;
}

function includeCustomerMembersForRequest(
  request: NonNullable<Awaited<ReturnType<typeof findRequestContext>>>,
) {
  const binding = request.createdByExternalContact?.binding;
  if (!binding) return true;
  return Boolean(
    binding.sub2ApiConnection?.customerMemberNotificationsEnabled ||
      binding.universalConnection?.customerMemberNotificationsEnabled,
  );
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
  if (!canAccessCustomerRequestModule(actor, request)) throw notFound();
  if (request.archivedAt) {
    throw conflict(
      "REQUEST_ARCHIVED",
      "已归档的服务请求不能上传附件，请先恢复到常规列表",
    );
  }
  if (request.status === "CLOSED") {
    throw conflict("REQUEST_CLOSED", "已关闭的请求不能上传附件");
  }

  const requestAccess = {
    assigneeId: request.assigneeId,
    assigneeIds: request.assignees.map((item) => item.userId),
    projectRole: getProjectRole(request),
  };
  const isCustomer = actor.platformRole === "CUSTOMER";
  if (!isCustomer && !canUploadRequestFile(actor, requestAccess)) {
    throw forbidden("只有请求处理人员或客户可以上传附件");
  }

  if (isCustomer && input.inline && !input.requestMessageId) {
    const policy = await getAttachmentPolicy();
    if (!policy.customerReplyAttachmentsEnabled) {
      throw forbidden("当前未开放客户在回复中插入图片");
    }
  }

  if (input.requestMessageId) {
    const message = await tx.requestMessage.findFirst({
      where: {
        id: input.requestMessageId,
        serviceRequestId: request.id,
      },
      select: {
        id: true,
        visibility: true,
        isInitial: true,
        authorId: true,
      },
    });
    if (!message) {
      throw notFound("请求消息不存在");
    }
    if (!canAttachToRequestMessage(actor, message)) {
      throw forbidden("只能为自己发送的消息上传附件");
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
    if (!actor.isStaff) {
      if (!message.isInitial) {
        const policy = await getAttachmentPolicy();
        if (!policy.customerReplyAttachmentsEnabled) {
          throw forbidden("当前未开放客户在回复中上传附件");
        }
      }
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

