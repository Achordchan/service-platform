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
  publishEvent,
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
  initialPreviewStatus,
  isOfficePreviewMimeType,
  normalizeAttachmentNote,
  normalizeAttachmentTitle,
} from "@/modules/attachments/attachment-meta";
import { queueAttachmentPreviewRender } from "@/lib/jobs";
import {
  assertCanContributeToProject,
  assertCanManageActiveProjectDelivery,
  assertCanManageProjectDelivery,
  assertCanPublishActiveProjectUpdate,
  assertCanPublishProjectUpdate,
  assertCanUploadActiveProjectFile,
  assertCanViewCustomerProjectFeature,
  loadProjectAccess,
} from "@/modules/projects/project-access";
import { assertAllowed } from "@/modules/projects/errors";
import { canUploadProjectFile } from "@/modules/projects/permissions";
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
      if (!input.inline && input.requestMessageId) {
        // 绑在某条回复上的附件属于那次回复的一部分：回复自己那条活动才是本次提醒，
        // 它已经按本次覆盖发过了。这里再按 REQUEST_ATTACHMENT 默认规则发一次，
        // 既重复打扰（一条带三个附件的回复多出三条），又绕开覆盖 ——
        // 附件上传是另一个请求、不带 deliveryOverride，被「本次不提醒」排除掉的人
        // 照样每个附件收一条。与项目动态/里程碑附件同一处理。
        // 但仍要发静默刷新事件：回复先落库、附件随后逐个传，别人页面收到回复事件时
        // 刷出来的是「没有附件」的版本。
        await publishEvent(tx, {
          type: "REQUEST_UPDATED",
          payload: {
            change: "REQUEST_ATTACHMENT_UPLOADED",
            actorId: actor.id,
            audible: false,
            requestId: request.id,
            attachmentId: attachment.id,
            requestMessageId: input.requestMessageId,
            visibility: attachment.visibility,
          },
          customerSpaceId: request.project.customerSpaceId,
          projectId: request.projectId,
          serviceRequestId: request.id,
        });
      } else if (!input.inline) {
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
  /**
   * 直接挂到进度动态 / 里程碑上的文件附件（非正文内嵌图）。
   * 与工单附件同一套两段式：先建实体、再带着实体 id 上传，
   * 避免草稿态附件先跑进项目文件列表。
   */
  attachTo?: { kind: "PROJECT_UPDATE" | "MILESTONE"; id: string };
  title?: string;
  note?: string;
};

export async function uploadProjectAttachment(
  actor: Actor,
  input: UploadProjectAttachmentInput,
) {
  const context = await withActorDb(actor, (tx) =>
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
  // 挂到动态上的附件跟随动态的可见性（内部动态的附件客户不可见），
  // 由服务端派生而不是信客户端；里程碑没有可见性维度，恒为客户可见。
  const visibility = context.attachVisibility ?? input.visibility ?? "CUSTOMER_VISIBLE";
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
          ...(input.attachTo?.kind === "PROJECT_UPDATE"
            ? { projectUpdateId: input.attachTo.id }
            : {}),
          ...(input.attachTo?.kind === "MILESTONE"
            ? { milestoneId: input.attachTo.id }
            : {}),
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
      if (input.attachTo && !input.inlineContext) {
        // 实体附件不发通知（理由见下），但必须补一个静默刷新事件：
        // 实体是先建好再逐个传附件的，别人页面收到实体事件时刷出来的是「没有附件」
        // 的版本，附件传完若不再发事件，就要一直等到手动重载或下一次项目事件。
        // audible: false + 不建通知行 —— 只刷新，不打扰。
        await publishEvent(tx, {
          type: "PROJECT_UPDATED",
          payload: {
            change: "PROJECT_ATTACHMENT_UPLOADED",
            actorId: actor.id,
            audible: false,
            projectId: project.projectId,
            attachmentId: attachment.id,
            ...(input.attachTo.kind === "PROJECT_UPDATE"
              ? { projectUpdateId: input.attachTo.id }
              : { milestoneId: input.attachTo.id }),
          },
          customerSpaceId: project.customerSpaceId,
          projectId: project.projectId,
        });
      }
      // 挂在动态 / 里程碑上的附件不再单独发「项目新增文件」通知：那条实体自己的
      // 活动才是本次提醒，它已经按本次覆盖发过了。这里再发一次不但重复打扰
      // （一条带三个附件的动态会多出三条通知），还会绕开覆盖 ——
      // 附件上传是另一个请求，不带 deliveryOverride，于是按默认规则通知，
      // 明确被「本次不提醒」排除掉的人照样收到站内/邮件/微信。
      if (!input.inlineContext && !input.attachTo) {
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
// （长期 PENDING 由 attachment-preview-sweep 兜底重捞）
export async function queuePreviewRenderIfNeeded(
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
      attachVisibility: undefined as ContentVisibility | undefined,
    };
  }
  // 直接挂到动态/里程碑上的文件附件：权限与发布该实体一致，
  // 并且必须确认目标实体真的属于这个项目（否则可跨项目挂载）
  if (input.attachTo) {
    if (input.attachTo.kind === "PROJECT_UPDATE") {
      const context = await assertCanPublishActiveProjectUpdate(
        tx,
        actor,
        input.projectId,
      );
      if (!hasRolePermission(actor, "file.upload")) {
        throw forbidden("当前角色无权上传文件");
      }
      const update = await tx.projectUpdate.findFirst({
        where: { id: input.attachTo.id, projectId: input.projectId },
        select: { visibility: true },
      });
      if (!update) throw notFound("进度动态不存在");
      return { ...context, attachVisibility: update.visibility };
    }
    const context = await assertCanManageActiveProjectDelivery(
      tx,
      actor,
      input.projectId,
    );
    if (!hasRolePermission(actor, "file.upload")) {
      throw forbidden("当前角色无权上传文件");
    }
    const milestone = await tx.milestone.findFirst({
      where: { id: input.attachTo.id, projectId: input.projectId },
      select: { id: true },
    });
    if (!milestone) throw notFound("里程碑不存在");
    return { ...context, attachVisibility: undefined };
  }
  const context = input.inlineContext
    ? input.inlineContext === "PROJECT_UPDATE"
      ? await assertCanPublishActiveProjectUpdate(tx, actor, input.projectId)
      : await assertCanManageActiveProjectDelivery(tx, actor, input.projectId)
    : await assertCanUploadActiveProjectFile(tx, actor, input.projectId);
  if (!hasRolePermission(actor, "file.upload")) {
    throw forbidden("当前角色无权上传文件");
  }
  return { ...context, attachVisibility: undefined };
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


/**
 * 「添加到项目文件」/「移出项目文件」。
 *
 * 只翻 pinnedToProjectAt 这一个标记，**不动 serviceRequestId / projectUpdateId
 * 等归属字段** —— attachment_access 策略仍按原归属裁决可见性：看不到源工单的
 * 人即使文件被收录也读不到。因此这个动作不会放宽任何可见性，客户与后台人员
 * 都可以对自己看得见的文件使用。
 */
export async function setAttachmentProjectPin(
  actor: Actor,
  attachmentId: string,
  pinned: boolean,
) {
  return withActorDb(actor, async (tx) => {
    const attachment = await tx.attachment.findUnique({
      where: { id: attachmentId },
      select: {
        id: true,
        projectId: true,
        customerSpaceId: true,
        visibility: true,
        pinnedToProjectAt: true,
        serviceRequestId: true,
        requestMessageId: true,
        projectUpdateId: true,
        updateCommentId: true,
        milestoneId: true,
      },
    });
    if (!attachment) throw notFound("附件不存在");
    if (!attachment.projectId) {
      throw badRequest("ATTACHMENT_NOT_IN_PROJECT", "该附件不属于任何项目");
    }
    // 项目级手动上传的文件本来就在列表里，收录/移出都没有意义
    const alreadyProjectFile =
      !attachment.serviceRequestId &&
      !attachment.requestMessageId &&
      !attachment.projectUpdateId &&
      !attachment.updateCommentId &&
      !attachment.milestoneId;
    if (alreadyProjectFile) {
      throw badRequest("ATTACHMENT_ALREADY_PROJECT_FILE", "该文件本就在项目文件中");
    }
    if (Boolean(attachment.pinnedToProjectAt) === pinned) {
      return { id: attachment.id, pinned };
    }
    await tx.attachment.update({
      where: { id: attachmentId },
      data: {
        pinnedToProjectAt: pinned ? new Date() : null,
        pinnedById: pinned ? actor.id : null,
      },
    });
    await writeAuditLog(tx, actor, {
      action: pinned ? "ATTACHMENT_PINNED_TO_PROJECT" : "ATTACHMENT_UNPINNED_FROM_PROJECT",
      resourceType: "Attachment",
      resourceId: attachmentId,
      projectId: attachment.projectId,
      serviceRequestId: attachment.serviceRequestId ?? undefined,
    });
    // 收录状态变了，项目文件聚合列表就跟着变：不发事件的话，别人开着的
    // 项目详情页会一直停在旧列表，直到手动刷新或碰巧收到别的项目事件。
    // 与附件上传那条一样：audible: false，只刷新、不打扰。
    if (attachment.customerSpaceId) {
      await publishEvent(tx, {
        type: "PROJECT_UPDATED",
        payload: {
          change: "PROJECT_ATTACHMENT_UPLOADED",
          actorId: actor.id,
          audible: false,
          projectId: attachment.projectId,
          attachmentId: attachment.id,
          // 收录/移出改的是项目文件聚合列表，归项目文件模块
          visibility: attachment.visibility,
        },
        customerSpaceId: attachment.customerSpaceId,
        projectId: attachment.projectId,
      });
    }
    return { id: attachment.id, pinned };
  });
}

/**
 * 删除项目文件。
 *
 * 只处理「项目文件」列表里能自主管理的那几类，权限跟着文件的归属走 ——
 * 谁能把它放进来，谁才能删：
 *   - 项目级手动上传的文件 → 与上传同权（管理员 / 有 file.upload 的负责人）
 *   - 挂在进度动态或其评论上的附件 → 与发布进度同权
 *   - 挂在里程碑上的附件 → 与管理交付同权
 * 工单沟通里收录进来的文件不在此列：那是工单会话的内容，这里只提供
 * 「移出项目文件」，真要删得回工单里删，否则从项目页就能抹掉聊天记录。
 * 正文内嵌图同理，跟着正文走，编辑正文时才会被清理。
 *
 * 项目处于 DRAFT 不额外拦：清理错传的文件不该等外部接入激活。注意这只是
 * 服务端不设限，前台「文件资料」tab 本就只在交付激活后才渲染（DRAFT 项目
 * 一律不展示交付相关 tab），所以 DRAFT 目前没有入口 —— 何况上传走的是
 * assertCanUploadActiveProjectFile，DRAFT 期间根本传不进新文件。要不要给
 * DRAFT 开一个文件入口是交付流程自己的产品决定，不在删除能力的范围里。
 */
export async function deleteProjectAttachment(
  actor: Actor,
  attachmentId: string,
) {
  return withActorDb(actor, async (tx) => {
    const attachment = await tx.attachment.findUnique({
      where: { id: attachmentId },
      select: {
        id: true,
        originalName: true,
        title: true,
        mimeType: true,
        size: true,
        visibility: true,
        inline: true,
        storageKey: true,
        previewStorageKey: true,
        projectId: true,
        customerSpaceId: true,
        serviceRequestId: true,
        requestMessageId: true,
        projectUpdateId: true,
        updateCommentId: true,
        milestoneId: true,
        milestoneCommentId: true,
      },
    });
    if (!attachment) throw notFound("附件不存在");
    if (!attachment.projectId) {
      throw badRequest("ATTACHMENT_NOT_IN_PROJECT", "该附件不属于任何项目");
    }
    const projectId = attachment.projectId;
    // 授权在前、业务规则在后：看不见这个附件的人被 RLS 挡在 findUnique
    // （attachment_select 按 app_can_access_project / app_can_access_request 裁决，
    // 拿到的是「附件不存在」），这里再要求调用者是项目内部人员，免得下面几条
    // 按归属给的提示把「这文件来自工单沟通」透给只是空间成员的客户。
    await assertCanContributeToProject(tx, actor, projectId);
    if (attachment.serviceRequestId || attachment.requestMessageId) {
      throw badRequest(
        "ATTACHMENT_FROM_REQUEST",
        "来自工单沟通的文件请在工单中删除，这里可以将它移出项目文件",
      );
    }
    if (attachment.inline) {
      throw badRequest(
        "ATTACHMENT_INLINE",
        "正文中的图片请通过编辑正文删除",
      );
    }

    if (attachment.projectUpdateId || attachment.updateCommentId) {
      await assertCanPublishProjectUpdate(tx, actor, projectId);
      // 里程碑评论的附件与里程碑同模块，按交付管理权限裁
    } else if (attachment.milestoneId || attachment.milestoneCommentId) {
      await assertCanManageProjectDelivery(tx, actor, projectId);
    } else {
      const context = await loadProjectAccess(tx, actor, projectId);
      assertAllowed(
        canUploadProjectFile(actor, context.access),
        "仅管理员或有文件上传权限的项目负责人可以删除项目文件",
      );
    }

    const storageKeys = [
      attachment.storageKey,
      attachment.previewStorageKey,
    ].filter((value): value is string => Boolean(value));

    await tx.attachment.delete({ where: { id: attachment.id } });
    // storageKeys 跟着删除审计一起进同一个事务：提交后到 removePrivateFile
    // 之间进程要是没了（重启 / 重新部署），文件就成了没有任何行指向的孤儿。
    // 键在这条审计里，按 action 即可捞出该删而未删的文件。
    await writeAuditLog(tx, actor, {
      action: "PROJECT_ATTACHMENT_DELETED",
      resourceType: "Attachment",
      resourceId: attachment.id,
      customerSpaceId: attachment.customerSpaceId ?? undefined,
      projectId,
      metadata: {
        originalName: attachment.originalName,
        title: attachment.title,
        mimeType: attachment.mimeType,
        size: attachment.size,
        visibility: attachment.visibility,
        storageKeys,
      },
    });
    // 与上传/收录同样的静默刷新：别人开着的项目页要跟着把这行去掉，
    // 但删文件不值得给客户推一条提醒，所以 audible: false、不建通知行。
    if (attachment.customerSpaceId) {
      await publishEvent(tx, {
        type: "PROJECT_UPDATED",
        payload: {
          change: "PROJECT_ATTACHMENT_DELETED",
          actorId: actor.id,
          audible: false,
          projectId,
          attachmentId: attachment.id,
          visibility: attachment.visibility,
          // 归属要带上：realtime-event-visibility 按它判这条事件属于
          // 动态 / 里程碑 / 项目文件哪个模块，客户关掉对应模块就收不到
          ...(attachment.projectUpdateId
            ? { projectUpdateId: attachment.projectUpdateId }
            : {}),
          ...(attachment.updateCommentId
            ? { updateCommentId: attachment.updateCommentId }
            : {}),
          ...(attachment.milestoneId
            ? { milestoneId: attachment.milestoneId }
            : {}),
        },
        customerSpaceId: attachment.customerSpaceId,
        projectId,
      });
    }
    return { projectId, storageKeys };
  }).then(async ({ projectId, storageKeys }) => {
    // 行已经删了，此时再抛错只会让调用方以为没删成。删失败的键再单独落一条
    // result: FAILED 的审计，把「该删而未删」直接标出来，省得运维拿上面那条
    // 删除审计里的 storageKeys 去逐个比对磁盘。文件本身没有可访问入口
    // （下载一律经附件行 + RLS），所以这是磁盘占用问题而非泄露；定时重试要
    // 覆盖动态/里程碑删除等同类路径，归到统一的存储清理任务，不在本次范围。
    const failed: Array<{ storageKey: string; error: string }> = [];
    for (const storageKey of storageKeys) {
      try {
        await removePrivateFile(storageKey);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failed.push({ storageKey, error: message });
        console.error("PROJECT_ATTACHMENT_FILE_DELETE_FAILED", {
          attachmentId,
          storageKey,
          error: message,
        });
      }
    }
    if (failed.length > 0) {
      try {
        await withActorDb(actor, (tx) =>
          writeAuditLog(tx, actor, {
            action: "PROJECT_ATTACHMENT_FILE_DELETE_FAILED",
            resourceType: "Attachment",
            resourceId: attachmentId,
            result: "FAILED",
            projectId,
            metadata: { failed },
          }),
        );
      } catch (auditError) {
        // 审计也写不进去就只剩日志了，但不能因此把已完成的删除报成失败
        console.error("PROJECT_ATTACHMENT_FILE_DELETE_AUDIT_FAILED", {
          attachmentId,
          error:
            auditError instanceof Error
              ? auditError.message
              : String(auditError),
        });
      }
    }
    return { deleted: true as const };
  });
}
