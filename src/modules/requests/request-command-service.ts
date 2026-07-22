import "server-only";

import type { Prisma, RequestStatus } from "@/generated/prisma/client";
import type { Actor } from "@/lib/actor";
import { withActorDb } from "@/lib/actor";
import { enqueueMail } from "@/lib/jobs";
import {
  buildMessagePreview,
  extractInlineAttachmentIds,
  hasMeaningfulHtml,
} from "@/lib/message-content";
import { sanitizeMessageHtml } from "@/lib/sanitize-html";
import { canArchiveRequestStatus } from "@/lib/request-archive";
import {
  buildSupportPlaybookMessageBody,
  snapshotSupportReplyPlaybook,
} from "@/lib/support-reply-playbooks";
import { claimUserInlineAttachments } from "@/modules/attachments/inline-attachment-service";
import { writeAuditLog } from "@/modules/audit/audit-service";
import { resolveUniversalActionUrl } from "@/modules/integrations/external/action-url";
import { enqueueExternalRequestStatusMail } from "@/modules/integrations/external/mail-service";
import {
  dispatchRequestActivity,
  requestStatusLabel,
} from "@/modules/notifications/notification-service";
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
  canConfirmRequestClosed,
  canManageRequestArchive,
  canManageRequestAssignment,
  canWorkOnRequest,
  canWriteInternalNote,
} from "@/modules/requests/request-permissions";
import type {
  AssignRequestInput,
  CreateRequestMessageInput,
} from "@/modules/requests/request-schemas";
import { findActiveSupportPlaybook } from "@/modules/requests/support-playbook-service";
import {
  assertRequestTransition,
  statusAfterCustomerReply,
  statusAfterStaffPublicReply,
} from "@/modules/requests/request-state-machine";
import type { MailTemplateKey } from "@/modules/platform-settings/mail-template-catalog";

type ExternalRequestMail = {
  to: string;
  templateKey: MailTemplateKey;
  variables: Record<string, string>;
  actionUrl: string;
};

async function enqueueExternalRequestMail(mail: ExternalRequestMail | null) {
  if (!mail) return;
  try {
    await enqueueMail(mail);
  } catch (error) {
    console.error("EXTERNAL_REQUEST_MAIL_QUEUE_FAILED", {
      templateKey: mail.templateKey,
      error: error instanceof Error ? error.message : "unknown",
    });
  }
}


function canSendExternalContactMail(
  request: NonNullable<Awaited<ReturnType<typeof findRequestContext>>>,
) {
  const contact = request.createdByExternalContact;
  const binding = contact?.binding;
  const connection = externalConnection(request);
  return Boolean(
    contact?.email &&
      contact.status === "ACTIVE" &&
      binding?.status === "ACTIVE" &&
      binding.plugin.enabled &&
      binding.plugin.healthStatus === "READY" &&
      connection?.emailNotificationsEnabled && connection.actionUrl,
  );
}

function externalConnection(
  request: NonNullable<Awaited<ReturnType<typeof findRequestContext>>>,
) {
  const binding = request.createdByExternalContact?.binding;
  if (binding?.sub2ApiConnection) {
    return {
      actionUrl: binding.sub2ApiConnection.baseUrl,
      emailNotificationsEnabled:
        binding.sub2ApiConnection.emailNotificationsEnabled,
      customerMemberNotificationsEnabled:
        binding.sub2ApiConnection.customerMemberNotificationsEnabled,
    };
  }
  const universal = binding?.universalConnection;
  return universal
    ? {
        actionUrl: resolveUniversalActionUrl(
          request.createdByExternalContact?.lastParentOrigin,
          universal.allowedOrigins,
        ),
        emailNotificationsEnabled: universal.emailNotificationsEnabled,
        customerMemberNotificationsEnabled:
          universal.customerMemberNotificationsEnabled,
      }
    : null;
}

function statusMail(
  request: NonNullable<Awaited<ReturnType<typeof findRequestContext>>>,
  status: RequestStatus,
): ExternalRequestMail | null {
  const contact = request.createdByExternalContact;
  const connection = externalConnection(request);
  if (!canSendExternalContactMail(request) || !connection) return null;
  const statusTemplates: Partial<Record<RequestStatus, MailTemplateKey>> = {
    WAITING_CUSTOMER: "EXTERNAL_REQUEST_WAITING_CUSTOMER",
    RESOLVED: "EXTERNAL_REQUEST_RESOLVED",
    CLOSED: "EXTERNAL_REQUEST_CLOSED",
  };
  const templateKey = statusTemplates[status];
  if (!templateKey) return null;
  if (!contact?.email) return null;
  return {
    to: contact.email,
    templateKey,
    actionUrl: connection.actionUrl!,
    variables: {
      recipientName: contact.displayName,
      requestNumber: request.number,
      requestTitle: request.title,
      projectName: request.project.title,
    },
  };
}

function accessContext(
  request: NonNullable<Awaited<ReturnType<typeof findRequestContext>>>,
) {
  const assigneeIds = request.assignees.map((item) => item.userId);
  return {
    assigneeId: request.assigneeId,
    assigneeIds,
    projectRole: getProjectRole(request),
  };
}

function assertRequestNotArchived(request: { archivedAt: Date | null }) {
  if (request.archivedAt) {
    throw conflict(
      "REQUEST_ARCHIVED",
      "已归档的服务请求只能查看，请先恢复到常规列表",
    );
  }
}

function normalizeAssigneeIds(input: AssignRequestInput) {
  if (input.assigneeIds !== undefined) {
    return Array.from(
      new Set(input.assigneeIds.map((id) => id.trim()).filter(Boolean)),
    );
  }
  if (input.assigneeId) {
    return [input.assigneeId];
  }
  return [] as string[];
}

function workerIdsFromRequest(
  request: NonNullable<Awaited<ReturnType<typeof findRequestContext>>>,
  extra: Array<string | null | undefined> = [],
) {
  return Array.from(
    new Set(
      [
        request.assigneeId,
        ...request.assignees.map((item) => item.userId),
        ...extra,
      ].filter((value): value is string => Boolean(value)),
    ),
  );
}

function includeCustomerMembers(
  request: NonNullable<Awaited<ReturnType<typeof findRequestContext>>>,
) {
  if (!request.createdByExternalContact) return true;
  return externalConnection(request)?.customerMemberNotificationsEnabled === true;
}

function buildAssignmentSystemMessage(
  actor: Actor,
  previousAssigneeIds: string[],
  nextAssignees: Array<{ userId: string; name: string }>,
) {
  const previous = new Set(previousAssigneeIds);
  const nextIds = nextAssignees.map((item) => item.userId);
  const next = new Set(nextIds);
  const added = nextAssignees.filter((item) => !previous.has(item.userId));
  const removedIds = previousAssigneeIds.filter((id) => !next.has(id));
  const names = nextAssignees.map((item) => item.name);

  if (nextAssignees.length === 0) {
    return `${actor.name} 已取消处理人`;
  }

  if (previous.size === 0) {
    if (nextAssignees.length === 1 && nextAssignees[0].userId === actor.id) {
      return `${actor.name} 已接手此请求`;
    }
    return `${actor.name} 将处理人设为 ${names.join("、")}`;
  }

  if (
    nextAssignees.length === 1 &&
    nextAssignees[0].userId === actor.id &&
    previous.size > 0 &&
    !(previous.size === 1 && previous.has(actor.id))
  ) {
    return `${actor.name} 已改为自己处理`;
  }

  if (
    added.length === nextAssignees.length &&
    removedIds.length === previous.size &&
    previous.size > 0
  ) {
    // full replace
    return `${actor.name} 将处理人设为 ${names.join("、")}`;
  }

  if (added.length > 0 && removedIds.length === 0) {
    const addedNames = added.map((item) =>
      item.userId === actor.id ? "自己" : item.name,
    );
    return `${actor.name} 添加处理人：${addedNames.join("、")}`;
  }

  if (added.length === 0 && removedIds.length > 0) {
    return `${actor.name} 已调整处理人，当前为 ${names.join("、")}`;
  }

  return `${actor.name} 将处理人设为 ${names.join("、")}`;
}

function hasAssignedWorkers(
  request: NonNullable<Awaited<ReturnType<typeof findRequestContext>>>,
) {
  return Boolean(request.assigneeId || request.assignees.length > 0);
}

async function createSystemMessage(
  tx: Parameters<typeof writeAuditLog>[0],
  request: NonNullable<Awaited<ReturnType<typeof findRequestContext>>>,
  actor: Actor,
  body: string,
) {
  return tx.requestMessage.create({
    data: {
      body,
      visibility: "CUSTOMER_VISIBLE",
      isSystem: true,
      serviceRequestId: request.id,
      authorId: actor.id,
    },
    select: {
      id: true,
      body: true,
      visibility: true,
      isSystem: true,
      authorId: true,
      createdAt: true,
    },
  });
}

async function claimRequestOnFirstPublicReply(
  tx: Parameters<typeof writeAuditLog>[0],
  actor: Actor,
  request: NonNullable<Awaited<ReturnType<typeof findRequestContext>>>,
) {
  if (
    actor.isPlatformAdmin ||
    actor.platformRole === "CUSTOMER" ||
    getProjectRole(request) === null ||
    hasAssignedWorkers(request)
  ) {
    return { request, claimed: false };
  }

  const locked = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id
    FROM "ServiceRequest"
    WHERE id = ${request.id}
    FOR UPDATE
  `;
  if (locked.length === 0) {
    throw conflict(
      "REQUEST_ALREADY_CLAIMED",
      "该请求已由其他人员接手，请刷新后重试",
    );
  }

  const current = await findRequestContext(tx, request.id, actor.id);
  if (!current) throw notFound();
  if (hasAssignedWorkers(current)) {
    return { request: current, claimed: false };
  }

  await tx.serviceRequest.update({
    where: { id: current.id },
    data: { assigneeId: actor.id },
    select: { id: true },
  });
  await tx.requestAssignee.create({
    data: {
      serviceRequestId: current.id,
      userId: actor.id,
      assignedById: actor.id,
    },
  });

  await writeAuditLog(tx, actor, {
    action: "REQUEST_AUTO_CLAIMED",
    resourceType: "ServiceRequest",
    resourceId: current.id,
    customerSpaceId: current.project.customerSpaceId,
    projectId: current.projectId,
    serviceRequestId: current.id,
    metadata: { assigneeId: actor.id, source: "FIRST_PUBLIC_REPLY" },
  });
  await createSystemMessage(
    tx,
    current,
    actor,
    `${actor.name} 已接手此请求`,
  );
  await dispatchRequestActivity(tx, actor, {
    eventType: "REQUEST_ASSIGNED",
    eventPayload: {
      requestId: current.id,
      requestNumber: current.number,
      assigneeId: actor.id,
      assigneeIds: [actor.id],
      actorId: actor.id,
      source: "FIRST_PUBLIC_REPLY",
    },
    notificationType: "REQUEST_ASSIGNED",
    notificationTitle: `${actor.name} 已接手请求 ${current.number}`,
    notificationBody: current.title,
    includeCustomers: includeCustomerMembers(current),
    includeExternalContact: Boolean(current.createdByExternalContactId),
    relevantWorkerUserIds: [actor.id],
    notifyProjectManagers: false,
    notifyPlatformAdmins: false,
    createNotifications: false,
    audible: false,
    customerSpaceId: current.project.customerSpaceId,
    projectId: current.projectId,
    serviceRequestId: current.id,
  });

  const claimedRequest = await findRequestContext(tx, current.id, actor.id);
  if (!claimedRequest) throw notFound();
  return { request: claimedRequest, claimed: true };
}

async function validateReplyTarget(
  tx: Parameters<typeof writeAuditLog>[0],
  actor: Actor,
  requestId: string,
  input: CreateRequestMessageInput,
) {
  if (!input.replyToMessageId) return null;
  const target = await tx.requestMessage.findFirst({
    where: {
      id: input.replyToMessageId,
      serviceRequestId: requestId,
    },
    select: {
      id: true,
      visibility: true,
      isSystem: true,
    },
  });
  if (!target) {
    throw notFound("回复的原消息不存在或无权访问");
  }
  if (target.isSystem) {
    throw badRequest("SYSTEM_MESSAGE_REPLY_FORBIDDEN", "系统消息不能回复");
  }
  if (
    target.visibility === "INTERNAL" &&
    (actor.platformRole === "CUSTOMER" ||
      input.visibility !== "INTERNAL")
  ) {
    throw forbidden("内部消息只能通过内部备注回复");
  }
  return target.id;
}

export function assignRequest(
  actor: Actor,
  requestId: string,
  input: AssignRequestInput,
) {
  return withActorDb(actor, async (tx) => {
    const request = await findRequestContext(tx, requestId, actor.id);
    if (!request) throw notFound();
    assertRequestNotArchived(request);
    if (!canManageRequestAssignment(actor, accessContext(request))) {
      throw forbidden("只有平台管理员或项目经理可以分配服务请求");
    }
    if (request.status === "CLOSED") {
      throw conflict("REQUEST_CLOSED", "已关闭的请求不能重新分配");
    }

    const assigneeIds = normalizeAssigneeIds(input);
    if (assigneeIds.length > 0) {
      const assignments = await tx.projectStaff.findMany({
        where: {
          projectId: request.projectId,
          userId: { in: assigneeIds },
        },
        select: { userId: true },
      });
      const assignedSet = new Set(assignments.map((item) => item.userId));
      const missing = assigneeIds.filter((id) => !assignedSet.has(id));
      if (missing.length > 0) {
        const admins = await tx.user.findMany({
          where: {
            id: { in: missing },
            platformRole: "PLATFORM_ADMIN",
          },
          select: { id: true },
        });
        if (admins.length !== missing.length) {
          throw conflict(
            "INVALID_REQUEST_ASSIGNEE",
            "处理人必须是该项目的工作人员或平台管理员",
          );
        }
      }
    }

    const primaryAssigneeId = assigneeIds[0] ?? null;
    await tx.requestAssignee.deleteMany({
      where: { serviceRequestId: requestId },
    });
    if (assigneeIds.length > 0) {
      await tx.requestAssignee.createMany({
        data: assigneeIds.map((userId) => ({
          serviceRequestId: requestId,
          userId,
          assignedById: actor.id,
        })),
      });
    }

    const updated = await tx.serviceRequest.update({
      where: { id: requestId },
      data: { assigneeId: primaryAssigneeId },
      select: {
        id: true,
        number: true,
        assigneeId: true,
        status: true,
        updatedAt: true,
        assignees: {
          select: {
            userId: true,
            user: { select: { id: true, name: true, email: true } },
          },
          orderBy: { assignedAt: "asc" },
        },
      },
    });

    await writeAuditLog(tx, actor, {
      action: "REQUEST_ASSIGNED",
      resourceType: "ServiceRequest",
      resourceId: request.id,
      customerSpaceId: request.project.customerSpaceId,
      projectId: request.projectId,
      serviceRequestId: request.id,
      metadata: {
        previousAssigneeId: request.assigneeId,
        previousAssigneeIds: request.assignees.map((item) => item.userId),
        assigneeId: primaryAssigneeId,
        assigneeIds,
      },
    });
    const previousAssigneeIds = Array.from(
      new Set(
        [
          request.assigneeId,
          ...request.assignees.map((item) => item.userId),
        ].filter((value): value is string => Boolean(value)),
      ),
    );
    const assignText = buildAssignmentSystemMessage(
      actor,
      previousAssigneeIds,
      updated.assignees.map((item) => ({
        userId: item.userId,
        name: item.user.name,
      })),
    );

    await dispatchRequestActivity(tx, actor, {
      eventType: "REQUEST_ASSIGNED",
      eventPayload: {
        requestId: request.id,
        requestNumber: request.number,
        assigneeId: primaryAssigneeId,
        assigneeIds,
        actorId: actor.id,
      },
      notificationType: "REQUEST_ASSIGNED",
      notificationTitle: `请求 ${request.number} 处理人已更新`,
      notificationBody: assignText,
      includeCustomers: includeCustomerMembers(request),
      includeExternalContact: Boolean(request.createdByExternalContactId),
      relevantWorkerUserIds: workerIdsFromRequest(request, assigneeIds),
      emailWorkerUserIds: assigneeIds.filter(
        (userId) => !previousAssigneeIds.includes(userId),
      ),
      notifyProjectManagers: false,
      notifyPlatformAdmins: false,
      customerSpaceId: request.project.customerSpaceId,
      projectId: request.projectId,
      serviceRequestId: request.id,
    });

    return updated;
  });
}

export async function changeRequestStatus(
  actor: Actor,
  requestId: string,
  targetStatus: RequestStatus,
) {
  const result = await withActorDb(actor, async (tx) => {
    const request = await findRequestContext(tx, requestId, actor.id);
    if (!request) throw notFound();
    assertRequestNotArchived(request);
    if (!canWorkOnRequest(actor, accessContext(request))) {
      throw forbidden("只有请求处理人、项目经理或平台管理员可以变更状态");
    }
    if (targetStatus === "CLOSED") {
      throw forbidden("关闭请求必须由客户在已解决状态下确认");
    }

    assertRequestTransition(request.status, targetStatus);
    const now = new Date();
    const updateResult = await tx.serviceRequest.updateMany({
      where: { id: requestId, status: request.status },
      data: {
        status: targetStatus,
        resolvedAt: targetStatus === "RESOLVED" ? now : null,
        closedAt: null,
      },
    });
    assertRequestWasNotChanged(updateResult.count);
    const updated = await tx.serviceRequest.findUniqueOrThrow({
      where: { id: requestId },
      select: {
        id: true,
        number: true,
        status: true,
        resolvedAt: true,
        closedAt: true,
        updatedAt: true,
      },
    });

    await writeStatusAudit(
      tx,
      actor,
      request,
      request.status,
      targetStatus,
      "STAFF_ACTION",
    );
    await dispatchStatusActivity(
      tx,
      actor,
      request,
      request.status,
      targetStatus,
      true,
    );
    return { updated, externalMail: statusMail(request, targetStatus) };
  });
  await enqueueExternalRequestMail(result.externalMail);
  return result.updated;
}

export async function changeRequestArchive(
  actor: Actor,
  requestId: string,
  archived: boolean,
) {
  return withActorDb(actor, async (tx) => {
    const request = await findRequestContext(tx, requestId, actor.id);
    if (!request || !canAccessCustomerRequestModule(actor, request)) {
      throw notFound();
    }
    if (!canManageRequestArchive(actor, accessContext(request))) {
      throw forbidden("只有后台请求处理人员可以归档或恢复服务请求");
    }
    if (archived && !canArchiveRequestStatus(request.status)) {
      throw conflict(
        "REQUEST_NOT_ARCHIVABLE",
        "只有已解决或已关闭的服务请求可以归档",
      );
    }
    if (Boolean(request.archivedAt) === archived) {
      return tx.serviceRequest.findUniqueOrThrow({
        where: { id: requestId },
        select: {
          id: true,
          number: true,
          status: true,
          archivedAt: true,
          updatedAt: true,
        },
      });
    }

    const archivedAt = archived ? new Date() : null;
    const result = await tx.serviceRequest.updateMany({
      where: { id: requestId, archivedAt: request.archivedAt },
      data: { archivedAt },
    });
    assertRequestWasNotChanged(result.count);
    const updated = await tx.serviceRequest.findUniqueOrThrow({
      where: { id: requestId },
      select: {
        id: true,
        number: true,
        status: true,
        archivedAt: true,
        updatedAt: true,
      },
    });

    await writeAuditLog(tx, actor, {
      action: archived ? "REQUEST_ARCHIVED" : "REQUEST_RESTORED",
      resourceType: "ServiceRequest",
      resourceId: request.id,
      customerSpaceId: request.project.customerSpaceId,
      projectId: request.projectId,
      serviceRequestId: request.id,
      metadata: { number: request.number, status: request.status },
    });
    await dispatchRequestActivity(tx, actor, {
      eventType: "REQUEST_UPDATED",
      eventPayload: {
        change: archived ? "REQUEST_ARCHIVED" : "REQUEST_RESTORED",
        actorId: actor.id,
        requestId: request.id,
        archived,
        archivedAt: archivedAt?.toISOString() ?? null,
      },
      notificationType: "REQUEST_ARCHIVE",
      notificationTitle: archived
        ? `请求 ${request.number} 已归档`
        : `请求 ${request.number} 已恢复`,
      notificationBody: request.title,
      includeCustomers: includeCustomerMembers(request),
      includeExternalContact: Boolean(request.createdByExternalContactId),
      relevantWorkerUserIds: workerIdsFromRequest(request),
      notifyProjectManagers: false,
      notifyPlatformAdmins: false,
      customerSpaceId: request.project.customerSpaceId,
      projectId: request.projectId,
      serviceRequestId: request.id,
    });
    return updated;
  });
}

export async function addRequestMessage(
  actor: Actor,
  requestId: string,
  input: CreateRequestMessageInput,
) {
  const result = await withActorDb(actor, async (tx) => {
    let request = await findRequestContext(tx, requestId, actor.id);
    if (!request) throw notFound();
    if (!canAccessCustomerRequestModule(actor, request)) throw notFound();
    assertRequestNotArchived(request);
    if (request.status === "CLOSED") {
      throw conflict("REQUEST_CLOSED", "已关闭的请求不能继续回复");
    }

    const isCustomer = actor.platformRole === "CUSTOMER";
    if (!isCustomer && input.visibility === "CUSTOMER_VISIBLE") {
      const claimed = await claimRequestOnFirstPublicReply(tx, actor, request);
      request = claimed.request;
    }

    const context = accessContext(request);
    if (input.visibility === "INTERNAL") {
      if (!canWriteInternalNote(actor, context)) {
        throw forbidden("只有请求处理人员可以添加内部备注");
      }
    } else if (!isCustomer && !canWorkOnRequest(actor, context)) {
      throw forbidden("只有请求处理人员或客户可以回复");
    }

    const supportPlaybook = input.supportPlaybookKey
      ? await findActiveSupportPlaybook(tx, input.supportPlaybookKey)
      : null;
    if (input.supportPlaybookKey && !supportPlaybook) {
      throw badRequest("SUPPORT_PLAYBOOK_NOT_FOUND", "处理指南不存在或已停用");
    }
    if (supportPlaybook && (!actor.isStaff || input.visibility === "INTERNAL")) {
      throw forbidden("处理指南只能由后台人员作为客户可见消息发送");
    }
    const sanitizedBody = supportPlaybook
      ? buildSupportPlaybookMessageBody(supportPlaybook)
      : sanitizeMessageHtml(input.body);
    if (!hasMeaningfulHtml(sanitizedBody)) {
      throw badRequest("EMPTY_MESSAGE", "回复内容不能为空");
    }
    if (sanitizedBody.length > 20_000) {
      throw badRequest("MESSAGE_TOO_LONG", "回复内容过长");
    }
    const replyToMessageId = await validateReplyTarget(
      tx,
      actor,
      request.id,
      input,
    );

    const message = await tx.requestMessage.create({
      data: {
        body: sanitizedBody,
        visibility: input.visibility,
        serviceRequestId: request.id,
        authorId: actor.id,
        replyToMessageId,
        supportPlaybookKey: supportPlaybook?.key,
        supportPlaybookSnapshot: supportPlaybook
          ? (snapshotSupportReplyPlaybook(
              supportPlaybook,
            ) as Prisma.InputJsonValue)
          : undefined,
      },
      select: {
        id: true,
        body: true,
        visibility: true,
        authorId: true,
        replyToMessageId: true,
        supportPlaybookKey: true,
        supportPlaybookSnapshot: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    await claimUserInlineAttachments(
      tx,
      actor,
      extractInlineAttachmentIds(sanitizedBody),
      {
        projectId: request.projectId,
        serviceRequestId: request.id,
        requestMessageId: message.id,
        visibility: input.visibility,
      },
    );

    await writeAuditLog(tx, actor, {
      action:
        input.visibility === "INTERNAL"
          ? "REQUEST_INTERNAL_NOTE_CREATED"
          : "REQUEST_MESSAGE_CREATED",
      resourceType: "RequestMessage",
      resourceId: message.id,
      customerSpaceId: request.project.customerSpaceId,
      projectId: request.projectId,
      serviceRequestId: request.id,
      metadata: {
        visibility: input.visibility,
        replyToMessageId,
        supportPlaybookKey: supportPlaybook?.key ?? null,
      },
    });
    const assignedWorkers = workerIdsFromRequest(request);
    const requestIsUnassigned = assignedWorkers.length === 0;
    const isInternal = input.visibility === "INTERNAL";
    await dispatchRequestActivity(tx, actor, {
      eventType: "REQUEST_MESSAGE_CREATED",
      eventPayload: {
        requestId: request.id,
        requestNumber: request.number,
        messageId: message.id,
        actorId: actor.id,
        visibility: input.visibility,
      },
      notificationType: "REQUEST_MESSAGE",
      notificationTitle:
        isInternal
          ? `${actor.name} 添加了内部备注`
          : `${actor.name} 回复了请求 ${request.number}`,
      notificationBody: buildMessagePreview(sanitizedBody),
      includeCustomers: !isInternal && includeCustomerMembers(request),
      includeExternalContact:
        !isInternal && Boolean(request.createdByExternalContactId),
      relevantWorkerUserIds: assignedWorkers,
      notifyProjectManagers: isInternal || requestIsUnassigned,
      notifyPlatformAdmins: !isInternal && requestIsUnassigned,
      customerSpaceId: request.project.customerSpaceId,
      projectId: request.projectId,
      serviceRequestId: request.id,
    });

    const nextStatus = isCustomer
      ? statusAfterCustomerReply(request.status)
      : input.visibility === "CUSTOMER_VISIBLE"
        ? statusAfterStaffPublicReply(request.status)
        : request.status;
    if (nextStatus !== request.status) {
      assertRequestTransition(request.status, nextStatus);
      const updateResult = await tx.serviceRequest.updateMany({
        where: { id: request.id, status: request.status },
        data: {
          status: nextStatus,
          resolvedAt: null,
          closedAt: null,
        },
      });
      assertRequestWasNotChanged(updateResult.count);
      await writeStatusAudit(
        tx,
        actor,
        request,
        request.status,
        nextStatus,
        isCustomer ? "CUSTOMER_REPLY" : "STAFF_PUBLIC_REPLY",
      );
      await dispatchStatusActivity(
        tx,
        actor,
        request,
        request.status,
        nextStatus,
        false,
      );
    }

    const contact = request.createdByExternalContact;
    const connection = externalConnection(request);
    const externalMail =
      !isCustomer &&
      input.visibility === "CUSTOMER_VISIBLE" &&
      canSendExternalContactMail(request) &&
      contact &&
      connection
        ? {
            to: contact.email!,
            templateKey: "EXTERNAL_REQUEST_PUBLIC_REPLY" as const,
            actionUrl: connection.actionUrl!,
            variables: {
              recipientName: contact.displayName,
              requestNumber: request.number,
              requestTitle: request.title,
              senderName: actor.name,
              messagePreview: buildMessagePreview(sanitizedBody),
              projectName: request.project.title,
            },
          }
        : null;
    return { message, requestStatus: nextStatus, externalMail };
  });
  await enqueueExternalRequestMail(result.externalMail);
  return { message: result.message, requestStatus: result.requestStatus };
}

export async function confirmRequestClosed(actor: Actor, requestId: string) {
  const result = await withActorDb(actor, async (tx) => {
    const request = await findRequestContext(tx, requestId, actor.id);
    if (!request) throw notFound();
    if (!canAccessCustomerRequestModule(actor, request)) throw notFound();
    assertRequestNotArchived(request);
    if (!canConfirmRequestClosed(actor)) {
      throw forbidden("只有客户可以确认关闭服务请求");
    }

    assertRequestTransition(request.status, "CLOSED");
    const updateResult = await tx.serviceRequest.updateMany({
      where: { id: request.id, status: request.status },
      data: {
        status: "CLOSED",
        closedAt: new Date(),
      },
    });
    assertRequestWasNotChanged(updateResult.count);
    const updated = await tx.serviceRequest.findUniqueOrThrow({
      where: { id: request.id },
      select: {
        id: true,
        number: true,
        status: true,
        resolvedAt: true,
        closedAt: true,
        updatedAt: true,
      },
    });

    await writeStatusAudit(
      tx,
      actor,
      request,
      request.status,
      "CLOSED",
      "CUSTOMER_CONFIRMATION",
    );
    await dispatchStatusActivity(
      tx,
      actor,
      request,
      request.status,
      "CLOSED",
      true,
    );
    return {
      updated,
      notifyExternalContact: Boolean(request.createdByExternalContactId),
    };
  });
  if (result.notifyExternalContact) {
    await enqueueExternalRequestStatusMail(requestId, "CLOSED");
  }
  return result.updated;
}

async function writeStatusAudit(
  tx: Parameters<typeof writeAuditLog>[0],
  actor: Actor,
  request: NonNullable<Awaited<ReturnType<typeof findRequestContext>>>,
  previousStatus: RequestStatus,
  status: RequestStatus,
  source: string,
) {
  await writeAuditLog(tx, actor, {
    action: "REQUEST_STATUS_CHANGED",
    resourceType: "ServiceRequest",
    resourceId: request.id,
    customerSpaceId: request.project.customerSpaceId,
    projectId: request.projectId,
    serviceRequestId: request.id,
    metadata: { previousStatus, status, source },
  });
}

async function dispatchStatusActivity(
  tx: Parameters<typeof writeAuditLog>[0],
  actor: Actor,
  request: NonNullable<Awaited<ReturnType<typeof findRequestContext>>>,
  previousStatus: RequestStatus,
  status: RequestStatus,
  createNotifications: boolean,
) {
  await dispatchRequestActivity(tx, actor, {
    eventType: "REQUEST_STATUS_CHANGED",
    eventPayload: {
      requestId: request.id,
      requestNumber: request.number,
      previousStatus,
      status,
      actorId: actor.id,
    },
    notificationType: "REQUEST_STATUS",
    notificationTitle: `${actor.name} 更新了请求 ${request.number}`,
    notificationBody: `${request.title} · ${requestStatusLabel(status)}`,
    includeCustomers: includeCustomerMembers(request),
    includeExternalContact: Boolean(request.createdByExternalContactId),
    relevantWorkerUserIds: workerIdsFromRequest(request),
    notifyProjectManagers: false,
    notifyPlatformAdmins: false,
    createNotifications,
    audible: createNotifications,
    customerSpaceId: request.project.customerSpaceId,
    projectId: request.projectId,
    serviceRequestId: request.id,
  });
}

function assertRequestWasNotChanged(updatedCount: number) {
  if (updatedCount !== 1) {
    throw conflict(
      "REQUEST_STATUS_CHANGED",
      "请求状态已被其他操作更新，请刷新后重试",
    );
  }
}
