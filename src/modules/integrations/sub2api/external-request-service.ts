import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import type { ExternalActor } from "@/lib/external-actor";
import { withExternalActorDb } from "@/lib/external-actor";
import {
  buildMessagePreview,
  escapeHtmlText,
  hasMeaningfulHtml,
} from "@/lib/message-content";
import { sanitizeMessageHtml } from "@/lib/sanitize-html";
import { writeExternalAuditLog } from "@/modules/audit/audit-service";
import {
  dispatchExternalRequestActivity,
} from "@/modules/notifications/notification-service";
import { DomainError } from "@/modules/projects/errors";
import { generateRequestNumber } from "@/modules/requests/request-number";
import {
  assertRequestTransition,
  statusAfterCustomerReply,
} from "@/modules/requests/request-state-machine";
import type {
  embedCreateRequestSchema,
  embedMessageSchema,
} from "@/modules/integrations/sub2api/schemas";
import type { z } from "zod";

type CreateInput = z.infer<typeof embedCreateRequestSchema>;
type MessageInput = z.infer<typeof embedMessageSchema>;

const userBriefSelect = {
  id: true,
  name: true,
  email: true,
  image: true,
  platformRole: true,
} as const;

const contactBriefSelect = {
  id: true,
  externalUserId: true,
  displayName: true,
  email: true,
  username: true,
  status: true,
} as const;

function serializeAuthor(input: {
  author: Prisma.UserGetPayload<{ select: typeof userBriefSelect }> | null;
  externalAuthor: Prisma.ExternalContactGetPayload<{
    select: typeof contactBriefSelect;
  }> | null;
}) {
  if (input.author) {
    return {
      id: input.author.id,
      type: "USER" as const,
      name: input.author.name,
      email: input.author.email,
      image: input.author.image,
      source: "ACHORD" as const,
      platformRole: input.author.platformRole,
    };
  }
  if (input.externalAuthor) {
    return {
      id: input.externalAuthor.id,
      type: "EXTERNAL_CONTACT" as const,
      name: input.externalAuthor.displayName,
      email: input.externalAuthor.email,
      image: null,
      source: "SUB2API" as const,
      externalUserId: input.externalAuthor.externalUserId,
      username: input.externalAuthor.username,
    };
  }
  return {
    id: "unavailable",
    type: "UNAVAILABLE" as const,
    name: "原作者已不可用",
    email: null,
    image: null,
    source: "SYSTEM" as const,
  };
}

function ensureProjectWritable(status: string) {
  if (status !== "ACTIVE") {
    throw new DomainError(
      "EXTERNAL_PROJECT_READ_ONLY",
      "当前项目只允许查看历史工单",
      409,
    );
  }
}

export function listExternalRequests(actor: ExternalActor) {
  return withExternalActorDb(actor, async (tx) => {
    const project = await tx.project.findUnique({
      where: { id: actor.projectId },
      select: {
        id: true,
        title: true,
        status: true,
        serviceType: {
          select: {
            requestCategories: {
              where: { active: true },
              select: { id: true, name: true },
              orderBy: { name: "asc" },
            },
          },
        },
      },
    });
    if (!project) {
      throw new DomainError("PROJECT_NOT_FOUND", "项目不存在", 404);
    }
    const requests = await tx.serviceRequest.findMany({
      where: {
        projectId: actor.projectId,
        createdByExternalContactId: actor.id,
      },
      select: {
        id: true,
        number: true,
        title: true,
        description: true,
        priority: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        category: { select: { id: true, name: true } },
        assignees: {
          select: { user: { select: { id: true, name: true, image: true } } },
          orderBy: { assignedAt: "asc" },
        },
      },
      orderBy: { updatedAt: "desc" },
    });
    return {
      project: {
        id: project.id,
        title: project.title,
        status: project.status,
        writable: project.status === "ACTIVE",
      },
      categories: project.serviceType.requestCategories,
      requests,
    };
  });
}

export function createExternalRequest(
  actor: ExternalActor,
  input: CreateInput,
  options: { customerMemberNotificationsEnabled: boolean },
) {
  return withExternalActorDb(actor, async (tx) => {
    const project = await tx.project.findUnique({
      where: { id: actor.projectId },
      select: {
        id: true,
        title: true,
        kind: true,
        status: true,
        serviceTypeId: true,
        customerSpaceId: true,
      },
    });
    if (!project || project.kind !== "EXTERNAL_INTEGRATION") {
      throw new DomainError("PROJECT_NOT_FOUND", "项目不存在", 404);
    }
    ensureProjectWritable(project.status);
    const category = await tx.requestCategory.findFirst({
      where: {
        id: input.categoryId,
        serviceTypeId: project.serviceTypeId,
        active: true,
      },
      select: { id: true, name: true },
    });
    if (!category) {
      throw new DomainError(
        "INVALID_REQUEST_CATEGORY",
        "所选分类不可用",
        422,
      );
    }
    const description = sanitizeMessageHtml(input.description);
    if (!hasMeaningfulHtml(description)) {
      throw new DomainError("EMPTY_DESCRIPTION", "请补充问题详情", 422);
    }
    const request = await tx.serviceRequest.create({
      data: {
        number: generateRequestNumber(),
        title: input.title,
        description,
        priority: input.priority,
        projectId: project.id,
        categoryId: category.id,
        createdByExternalContactId: actor.id,
      },
      select: {
        id: true,
        number: true,
        title: true,
        description: true,
        priority: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        category: { select: { id: true, name: true } },
      },
    });
    const initialMessage = await tx.requestMessage.create({
      data: {
        body: `<h3>${escapeHtmlText(input.title.trim())}</h3>${description}`,
        visibility: "CUSTOMER_VISIBLE",
        isInitial: true,
        serviceRequestId: request.id,
        externalAuthorId: actor.id,
      },
      select: { id: true },
    });
    await writeExternalAuditLog(tx, actor, {
      action: "REQUEST_CREATED",
      resourceType: "ServiceRequest",
      resourceId: request.id,
      serviceRequestId: request.id,
      metadata: {
        actorType: "EXTERNAL_CONTACT",
        source: "SUB2API",
        categoryId: category.id,
        priority: request.priority,
      },
    });
    await dispatchExternalRequestActivity(tx, actor, {
      eventType: "REQUEST_CREATED",
      eventPayload: {
        actorType: "EXTERNAL_CONTACT",
        source: "SUB2API",
        actorId: actor.id,
        projectId: project.id,
        requestId: request.id,
        requestNumber: request.number,
      },
      notificationType: "REQUEST_CREATED",
      notificationTitle: `${actor.name} 提交了外部请求 ${request.number}`,
      notificationBody: `${request.title}：${buildMessagePreview(description)}`,
      includeCustomers: options.customerMemberNotificationsEnabled,
      notifyProjectManagers: true,
      notifyPlatformAdmins: true,
      customerSpaceId: project.customerSpaceId,
      projectId: project.id,
      serviceRequestId: request.id,
    });
    return { ...request, initialMessageId: initialMessage.id };
  });
}

export function getExternalRequest(actor: ExternalActor, requestId: string) {
  return withExternalActorDb(actor, async (tx) => {
    const request = await tx.serviceRequest.findFirst({
      where: {
        id: requestId,
        projectId: actor.projectId,
        createdByExternalContactId: actor.id,
      },
      select: {
        id: true,
        number: true,
        title: true,
        description: true,
        priority: true,
        status: true,
        resolvedAt: true,
        closedAt: true,
        createdAt: true,
        updatedAt: true,
        category: { select: { id: true, name: true } },
        project: { select: { id: true, title: true, status: true } },
        assignees: {
          select: { user: { select: userBriefSelect } },
          orderBy: { assignedAt: "asc" },
        },
        messages: {
          where: { visibility: "CUSTOMER_VISIBLE" },
          select: {
            id: true,
            body: true,
            visibility: true,
            isSystem: true,
            isInitial: true,
            replyToMessageId: true,
            createdAt: true,
            updatedAt: true,
            author: { select: userBriefSelect },
            externalAuthor: { select: contactBriefSelect },
            attachments: {
              where: { visibility: "CUSTOMER_VISIBLE" },
              select: {
                id: true,
                originalName: true,
                mimeType: true,
                size: true,
                createdAt: true,
              },
              orderBy: { createdAt: "asc" },
            },
            replyTo: {
              select: {
                id: true,
                body: true,
                visibility: true,
                isSystem: true,
                author: { select: userBriefSelect },
                externalAuthor: { select: contactBriefSelect },
                attachments: {
                  select: { id: true, originalName: true },
                  orderBy: { createdAt: "asc" },
                },
              },
            },
          },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        },
        attachments: {
          where: {
            visibility: "CUSTOMER_VISIBLE",
            requestMessageId: null,
          },
          select: {
            id: true,
            originalName: true,
            mimeType: true,
            size: true,
            createdAt: true,
          },
          orderBy: { createdAt: "asc" },
        },
      },
    });
    if (!request) {
      throw new DomainError("REQUEST_NOT_FOUND", "工单不存在", 404);
    }
    return {
      ...request,
      writable: request.project.status === "ACTIVE" && request.status !== "CLOSED",
      messages: request.messages.map((message) => ({
        ...message,
        author: serializeAuthor(message),
        replyTo: message.replyTo
          ? {
              ...message.replyTo,
              author: serializeAuthor(message.replyTo),
            }
          : null,
      })),
    };
  });
}

export function addExternalRequestMessage(
  actor: ExternalActor,
  requestId: string,
  input: MessageInput,
  options: { customerMemberNotificationsEnabled: boolean },
) {
  return withExternalActorDb(actor, async (tx) => {
    const request = await tx.serviceRequest.findFirst({
      where: {
        id: requestId,
        projectId: actor.projectId,
        createdByExternalContactId: actor.id,
      },
      select: {
        id: true,
        number: true,
        title: true,
        status: true,
        assigneeId: true,
        assignees: { select: { userId: true } },
        project: {
          select: { id: true, status: true, customerSpaceId: true },
        },
      },
    });
    if (!request) {
      throw new DomainError("REQUEST_NOT_FOUND", "工单不存在", 404);
    }
    ensureProjectWritable(request.project.status);
    if (request.status === "CLOSED") {
      throw new DomainError("REQUEST_CLOSED", "已关闭的工单不能回复", 409);
    }
    const body = sanitizeMessageHtml(input.body);
    if (!hasMeaningfulHtml(body)) {
      throw new DomainError("EMPTY_MESSAGE", "回复内容不能为空", 422);
    }
    let replyToMessageId: string | null = null;
    if (input.replyToMessageId) {
      const target = await tx.requestMessage.findFirst({
        where: {
          id: input.replyToMessageId,
          serviceRequestId: request.id,
          visibility: "CUSTOMER_VISIBLE",
          isSystem: false,
        },
        select: { id: true },
      });
      if (!target) {
        throw new DomainError(
          "REPLY_TARGET_UNAVAILABLE",
          "回复的原消息不可用",
          404,
        );
      }
      replyToMessageId = target.id;
    }
    const message = await tx.requestMessage.create({
      data: {
        body,
        visibility: "CUSTOMER_VISIBLE",
        serviceRequestId: request.id,
        externalAuthorId: actor.id,
        replyToMessageId,
      },
      select: {
        id: true,
        body: true,
        visibility: true,
        externalAuthorId: true,
        replyToMessageId: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    const nextStatus = statusAfterCustomerReply(request.status);
    if (nextStatus !== request.status) {
      assertRequestTransition(request.status, nextStatus);
      const updateResult = await tx.serviceRequest.updateMany({
        where: { id: request.id, status: request.status },
        data: { status: nextStatus, resolvedAt: null, closedAt: null },
      });
      if (updateResult.count !== 1) {
        throw new DomainError(
          "REQUEST_STATUS_CONFLICT",
          "工单状态已变更，请刷新后重试",
          409,
        );
      }
      await writeExternalAuditLog(tx, actor, {
        action: "REQUEST_STATUS_CHANGED",
        resourceType: "ServiceRequest",
        resourceId: request.id,
        serviceRequestId: request.id,
        metadata: {
          actorType: "EXTERNAL_CONTACT",
          source: "EXTERNAL_CUSTOMER_REPLY",
          previousStatus: request.status,
          status: nextStatus,
        },
      });
    }
    await writeExternalAuditLog(tx, actor, {
      action: "REQUEST_MESSAGE_CREATED",
      resourceType: "RequestMessage",
      resourceId: message.id,
      serviceRequestId: request.id,
      metadata: {
        actorType: "EXTERNAL_CONTACT",
        source: "SUB2API",
        replyToMessageId,
      },
    });
    const workers = Array.from(
      new Set(
        [request.assigneeId, ...request.assignees.map((item) => item.userId)]
          .filter((value): value is string => Boolean(value)),
      ),
    );
    await dispatchExternalRequestActivity(tx, actor, {
      eventType: "REQUEST_MESSAGE_CREATED",
      eventPayload: {
        actorType: "EXTERNAL_CONTACT",
        source: "SUB2API",
        actorId: actor.id,
        requestId: request.id,
        requestNumber: request.number,
        messageId: message.id,
        visibility: "CUSTOMER_VISIBLE",
      },
      notificationType: "REQUEST_MESSAGE",
      notificationTitle: `${actor.name} 回复了外部请求 ${request.number}`,
      notificationBody: buildMessagePreview(body),
      includeCustomers: options.customerMemberNotificationsEnabled,
      relevantWorkerUserIds: workers,
      notifyProjectManagers: true,
      notifyPlatformAdmins: true,
      customerSpaceId: request.project.customerSpaceId,
      projectId: request.project.id,
      serviceRequestId: request.id,
    });
    if (nextStatus !== request.status) {
      // Directed staff/customer events + one request-scoped null event for embed.
      // Auto status transitions do not create notification-center noise.
      await dispatchExternalRequestActivity(tx, actor, {
        eventType: "REQUEST_STATUS_CHANGED",
        eventPayload: {
          actorType: "EXTERNAL_CONTACT",
          actorId: actor.id,
          requestId: request.id,
          requestNumber: request.number,
          previousStatus: request.status,
          status: nextStatus,
          source: "EXTERNAL_CUSTOMER_REPLY",
        },
        notificationType: "REQUEST_STATUS",
        notificationTitle: `外部请求 ${request.number} 状态已更新`,
        notificationBody: request.title,
        includeCustomers: options.customerMemberNotificationsEnabled,
        relevantWorkerUserIds: workers,
        notifyProjectManagers: true,
        notifyPlatformAdmins: true,
        createNotifications: false,
        customerSpaceId: request.project.customerSpaceId,
        projectId: request.project.id,
        serviceRequestId: request.id,
      });
    }
    return { message, requestStatus: nextStatus };
  });
}


export function confirmExternalRequestClosed(
  actor: ExternalActor,
  requestId: string,
) {
  return withExternalActorDb(actor, async (tx) => {
    const request = await tx.serviceRequest.findFirst({
      where: {
        id: requestId,
        projectId: actor.projectId,
        createdByExternalContactId: actor.id,
      },
      select: {
        id: true,
        number: true,
        title: true,
        status: true,
        project: {
          select: { id: true, status: true, customerSpaceId: true, title: true },
        },
      },
    });
    if (!request) {
      throw new DomainError("REQUEST_NOT_FOUND", "工单不存在", 404);
    }
    ensureProjectWritable(request.project.status);
    assertRequestTransition(request.status, "CLOSED");
    const updateResult = await tx.serviceRequest.updateMany({
      where: { id: request.id, status: request.status },
      data: {
        status: "CLOSED",
        closedAt: new Date(),
      },
    });
    if (updateResult.count !== 1) {
      throw new DomainError(
        "REQUEST_STATUS_CONFLICT",
        "工单状态已变更，请刷新后重试",
        409,
      );
    }
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
    await writeExternalAuditLog(tx, actor, {
      action: "REQUEST_STATUS_CHANGED",
      resourceType: "ServiceRequest",
      resourceId: request.id,
      serviceRequestId: request.id,
      metadata: {
        actorType: "EXTERNAL_CONTACT",
        source: "EXTERNAL_CUSTOMER_CONFIRMATION",
        previousStatus: request.status,
        status: "CLOSED",
      },
    });
    await dispatchExternalRequestActivity(tx, actor, {
      eventType: "REQUEST_STATUS_CHANGED",
      eventPayload: {
        actorType: "EXTERNAL_CONTACT",
        source: "SUB2API",
        actorId: actor.id,
        requestId: request.id,
        requestNumber: request.number,
        previousStatus: request.status,
        status: "CLOSED",
      },
      notificationType: "REQUEST_STATUS",
      notificationTitle: `外部请求 ${request.number} 已关闭`,
      notificationBody: request.title,
      includeCustomers: false,
      notifyProjectManagers: true,
      notifyPlatformAdmins: true,
      customerSpaceId: request.project.customerSpaceId,
      projectId: request.project.id,
      serviceRequestId: request.id,
    });
    return updated;
  });
}
