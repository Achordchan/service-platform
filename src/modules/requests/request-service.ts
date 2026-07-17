import "server-only";

import type { Actor } from "@/lib/actor";
import { withActorDb } from "@/lib/actor";
import { writeAuditLog } from "@/modules/audit/audit-service";
import { dispatchRequestActivity } from "@/modules/notifications/notification-service";
import { badRequest, notFound } from "@/modules/requests/errors";
import { generateRequestNumber } from "@/modules/requests/request-number";
import type { CreateRequestInput } from "@/modules/requests/request-schemas";
import {
  buildMessagePreview,
  escapeHtmlText,
  hasMeaningfulHtml,
} from "@/lib/message-content";
import { sanitizeMessageHtml } from "@/lib/sanitize-html";

const userBriefSelect = {
  id: true,
  name: true,
  email: true,
  image: true,
  platformRole: true,
} as const;

const externalContactBriefSelect = {
  id: true,
  externalUserId: true,
  email: true,
  username: true,
  displayName: true,
  status: true,
} as const;

const requestSummarySelect = {
  id: true,
  number: true,
  title: true,
  description: true,
  priority: true,
  status: true,
  projectId: true,
  categoryId: true,
  createdById: true,
  createdByExternalContactId: true,
  assigneeId: true,
  resolvedAt: true,
  closedAt: true,
  createdAt: true,
  updatedAt: true,
  category: {
    select: { id: true, name: true },
  },
  assignee: {
    select: userBriefSelect,
  },
  assignees: {
    select: {
      userId: true,
      assignedAt: true,
      user: { select: userBriefSelect },
    },
    orderBy: { assignedAt: "asc" as const },
  },
  createdBy: {
    select: userBriefSelect,
  },
  createdByExternalContact: {
    select: externalContactBriefSelect,
  },
} as const;

export function createRequest(
  actor: Actor,
  projectId: string,
  input: CreateRequestInput,
) {
  return withActorDb(actor, async (tx) => {
    const project = await tx.project.findUnique({
      where: { id: projectId },
      select: {
        id: true,
        status: true,
        serviceTypeId: true,
        customerSpaceId: true,
      },
    });
    if (!project) {
      throw notFound("项目不存在或无权访问");
    }
    if (project.status !== "ACTIVE") {
      throw badRequest(
        "PROJECT_NOT_ACTIVE",
        "只有进行中的项目可以创建服务请求",
      );
    }

    const category = await tx.requestCategory.findFirst({
      where: {
        id: input.categoryId,
        serviceTypeId: project.serviceTypeId,
        active: true,
      },
      select: { id: true },
    });
    if (!category) {
      throw badRequest(
        "INVALID_REQUEST_CATEGORY",
        "所选分类不属于该项目的服务类型或已停用",
      );
    }

    const sanitizedDescription = sanitizeMessageHtml(input.description);
    if (!hasMeaningfulHtml(sanitizedDescription)) {
      throw badRequest("EMPTY_DESCRIPTION", "请补充问题详情");
    }
    if (sanitizedDescription.length > 20_000) {
      throw badRequest("DESCRIPTION_TOO_LONG", "问题详情过长");
    }

    const request = await tx.serviceRequest.create({
      data: {
        number: generateRequestNumber(),
        title: input.title,
        description: sanitizedDescription,
        priority: input.priority,
        projectId,
        categoryId: category.id,
        createdById: actor.id,
      },
      select: requestSummarySelect,
    });
    const initialMessage = await tx.requestMessage.create({
      data: {
        body: `<h3>${escapeHtmlText(input.title.trim())}</h3>${sanitizedDescription}`,
        visibility: "CUSTOMER_VISIBLE",
        isInitial: true,
        serviceRequestId: request.id,
        authorId: actor.id,
      },
      select: { id: true },
    });

    await writeAuditLog(tx, actor, {
      action: "REQUEST_CREATED",
      resourceType: "ServiceRequest",
      resourceId: request.id,
      customerSpaceId: project.customerSpaceId,
      projectId,
      serviceRequestId: request.id,
      metadata: {
        number: request.number,
        categoryId: category.id,
        priority: request.priority,
      },
    });
    await dispatchRequestActivity(tx, actor, {
      eventType: "REQUEST_CREATED",
      eventPayload: {
        projectId,
        requestId: request.id,
        requestNumber: request.number,
        actorId: actor.id,
      },
      notificationType: "REQUEST_CREATED",
      notificationTitle: `${actor.name} 提交了请求 ${request.number}`,
      notificationBody: `${request.title}：${buildMessagePreview(
        sanitizedDescription,
      )}`,
      includeCustomers: true,
      notifyProjectManagers: true,
      notifyPlatformAdmins: true,
      customerSpaceId: project.customerSpaceId,
      projectId,
      serviceRequestId: request.id,
    });

    return { ...request, initialMessageId: initialMessage.id };
  });
}

export function listProjectRequests(actor: Actor, projectId: string) {
  return withActorDb(actor, async (tx) => {
    const project = await tx.project.findUnique({
      where: { id: projectId },
      select: { id: true },
    });
    if (!project) {
      throw notFound("项目不存在或无权访问");
    }

    return tx.serviceRequest.findMany({
      where: {
        projectId,
        ...(actor.platformRole === "TECHNICIAN"
          ? {
              OR: [
                { assigneeId: actor.id },
                { assignees: { some: { userId: actor.id } } },
                {
                  assigneeId: null,
                  assignees: { none: {} },
                },
              ],
            }
          : {}),
      },
      select: requestSummarySelect,
      orderBy: { createdAt: "desc" },
    });
  });
}

export function getRequest(actor: Actor, requestId: string) {
  return withActorDb(actor, async (tx) => {
    const visibleContent = actor.isStaff
      ? undefined
      : { visibility: "CUSTOMER_VISIBLE" as const };
    const request = await tx.serviceRequest.findUnique({
      where: { id: requestId },
      select: {
        ...requestSummarySelect,
        project: {
          select: {
            id: true,
            title: true,
            customerSpaceId: true,
          },
        },
        messages: {
          where: visibleContent,
          select: {
            id: true,
            body: true,
            visibility: true,
            isSystem: true,
            isInitial: true,
            authorId: true,
            externalAuthorId: true,
            replyToMessageId: true,
            createdAt: true,
            updatedAt: true,
            author: {
              select: userBriefSelect,
            },
            externalAuthor: {
              select: externalContactBriefSelect,
            },
            attachments: {
              where: visibleContent,
              select: {
                id: true,
                originalName: true,
                mimeType: true,
                size: true,
                visibility: true,
                createdAt: true,
              },
            },
            replyTo: {
              select: {
                id: true,
                body: true,
                visibility: true,
                isSystem: true,
                authorId: true,
                externalAuthorId: true,
                author: {
                  select: {
                    id: true,
                    name: true,
                  },
                },
                externalAuthor: {
                  select: externalContactBriefSelect,
                },
                attachments: {
                  select: {
                    id: true,
                    originalName: true,
                  },
                  orderBy: { createdAt: "asc" },
                },
              },
            },
          },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        },
        attachments: {
          where: {
            requestMessageId: null,
            ...visibleContent,
          },
          select: {
            id: true,
            originalName: true,
            mimeType: true,
            size: true,
            visibility: true,
            createdAt: true,
          },
          orderBy: { createdAt: "asc" },
        },
      },
    });

    if (!request) {
      throw notFound();
    }
    return request;
  });
}
