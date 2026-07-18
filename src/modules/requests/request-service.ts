import "server-only";

import type { Prisma } from "@/generated/prisma/client";
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

const requestBaseSelect = {
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
} as const;

type RequestBase = Prisma.ServiceRequestGetPayload<{
  select: typeof requestBaseSelect;
}>;

async function loadRequestPeople(
  tx: Prisma.TransactionClient,
  userIds: string[],
  contactIds: string[],
) {
  const users = await tx.user.findMany({
    where: { id: { in: Array.from(new Set(userIds)) } },
    select: userBriefSelect,
  });
  const contacts = await tx.externalContact.findMany({
    where: { id: { in: Array.from(new Set(contactIds)) } },
    select: {
      id: true,
      bindingId: true,
      externalUserId: true,
      email: true,
      username: true,
      displayName: true,
      status: true,
      avatarUrl: true,
      profileAttributes: true,
    },
  });
  const bindings = await tx.projectPluginBinding.findMany({
    where: { id: { in: contacts.map((contact) => contact.bindingId) } },
    select: { id: true, pluginKey: true },
  });
  const pluginKeyByBindingId = new Map(
    bindings.map((binding) => [binding.id, binding.pluginKey]),
  );
  return {
    userById: new Map(users.map((user) => [user.id, user])),
    contactById: new Map(
      contacts.map((contact) => [
        contact.id,
        {
          id: contact.id,
          externalUserId: contact.externalUserId,
          email: contact.email,
          username: contact.username,
          displayName: contact.displayName,
          status: contact.status,
          avatarUrl: contact.avatarUrl,
          profileAttributes: contact.profileAttributes,
          binding: {
            pluginKey:
              pluginKeyByBindingId.get(contact.bindingId) ??
              "sub2api-connector",
          },
        },
      ]),
    ),
  };
}

async function hydrateRequestSummaries(
  tx: Prisma.TransactionClient,
  requests: RequestBase[],
) {
  if (requests.length === 0) return [];
  const requestIds = requests.map((request) => request.id);
  const categories = await tx.requestCategory.findMany({
    where: { id: { in: requests.map((request) => request.categoryId) } },
    select: { id: true, name: true },
  });
  const assigneeRows = await tx.requestAssignee.findMany({
    where: { serviceRequestId: { in: requestIds } },
    select: { serviceRequestId: true, userId: true, assignedAt: true },
    orderBy: { assignedAt: "asc" },
  });
  const { userById, contactById } = await loadRequestPeople(
    tx,
    [
      ...requests.map((request) => request.createdById),
      ...requests.map((request) => request.assigneeId),
      ...assigneeRows.map((item) => item.userId),
    ].filter((value): value is string => Boolean(value)),
    requests
      .map((request) => request.createdByExternalContactId)
      .filter((value): value is string => Boolean(value)),
  );
  const categoryById = new Map(categories.map((category) => [category.id, category]));
  const assigneesByRequestId = new Map<string, typeof assigneeRows>();
  for (const row of assigneeRows) {
    const current = assigneesByRequestId.get(row.serviceRequestId) ?? [];
    current.push(row);
    assigneesByRequestId.set(row.serviceRequestId, current);
  }
  return requests.map((request) => ({
    ...request,
    category: categoryById.get(request.categoryId) ?? {
      id: request.categoryId,
      name: "分类已删除",
    },
    assignee: request.assigneeId
      ? userById.get(request.assigneeId) ?? null
      : null,
    assignees: (assigneesByRequestId.get(request.id) ?? [])
      .map((row) => {
        const user = userById.get(row.userId);
        return user
          ? { userId: row.userId, assignedAt: row.assignedAt, user }
          : null;
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item)),
    createdBy: request.createdById
      ? userById.get(request.createdById) ?? null
      : null,
    createdByExternalContact: request.createdByExternalContactId
      ? contactById.get(request.createdByExternalContactId) ?? null
      : null,
  }));
}

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
      select: requestBaseSelect,
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

    const [summary] = await hydrateRequestSummaries(tx, [request]);
    return { ...summary, initialMessageId: initialMessage.id };
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

    const requests = await tx.serviceRequest.findMany({
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
      select: requestBaseSelect,
      orderBy: { createdAt: "desc" },
    });
    return hydrateRequestSummaries(tx, requests);
  });
}

export function getRequest(actor: Actor, requestId: string) {
  return withActorDb(actor, async (tx) => {
    const visibleContent = actor.isStaff
      ? undefined
      : { visibility: "CUSTOMER_VISIBLE" as const };
    const request = await tx.serviceRequest.findUnique({
      where: { id: requestId },
      select: requestBaseSelect,
    });

    if (!request) {
      throw notFound();
    }
    const [summary] = await hydrateRequestSummaries(tx, [request]);
    const project = await tx.project.findUniqueOrThrow({
      where: { id: request.projectId },
      select: { id: true, title: true, customerSpaceId: true },
    });
    const messages = await tx.requestMessage.findMany({
      where: { serviceRequestId: request.id, ...visibleContent },
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
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    const { userById, contactById } = await loadRequestPeople(
      tx,
      messages
        .map((message) => message.authorId)
        .filter((value): value is string => Boolean(value)),
      messages
        .map((message) => message.externalAuthorId)
        .filter((value): value is string => Boolean(value)),
    );
    const attachments = await tx.attachment.findMany({
      where: { serviceRequestId: request.id, ...visibleContent },
      select: {
        id: true,
        requestMessageId: true,
        originalName: true,
        mimeType: true,
        size: true,
        visibility: true,
        createdAt: true,
      },
      orderBy: { createdAt: "asc" },
    });
    const attachmentsByMessageId = new Map<string, typeof attachments>();
    for (const attachment of attachments) {
      if (!attachment.requestMessageId) continue;
      const current = attachmentsByMessageId.get(attachment.requestMessageId) ?? [];
      current.push(attachment);
      attachmentsByMessageId.set(attachment.requestMessageId, current);
    }
    const messageById = new Map(messages.map((message) => [message.id, message]));
    const authorFor = (message: (typeof messages)[number]) => ({
      author: message.authorId ? userById.get(message.authorId) ?? null : null,
      externalAuthor: message.externalAuthorId
        ? contactById.get(message.externalAuthorId) ?? null
        : null,
    });
    return {
      ...summary,
      project,
      messages: messages.map((message) => {
        const replyTo = message.replyToMessageId
          ? messageById.get(message.replyToMessageId)
          : null;
        return {
          ...message,
          author: authorFor(message).author,
          externalAuthor: authorFor(message).externalAuthor,
          attachments: (attachmentsByMessageId.get(message.id) ?? []).map(
            (attachment) => ({
              id: attachment.id,
              originalName: attachment.originalName,
              mimeType: attachment.mimeType,
              size: attachment.size,
              visibility: attachment.visibility,
              createdAt: attachment.createdAt,
            }),
          ),
          replyTo: replyTo
            ? {
                id: replyTo.id,
                body: replyTo.body,
                visibility: replyTo.visibility,
                isSystem: replyTo.isSystem,
                authorId: replyTo.authorId,
                externalAuthorId: replyTo.externalAuthorId,
                author: authorFor(replyTo).author
                  ? {
                      id: authorFor(replyTo).author!.id,
                      name: authorFor(replyTo).author!.name,
                    }
                  : null,
                externalAuthor: authorFor(replyTo).externalAuthor,
                attachments: (attachmentsByMessageId.get(replyTo.id) ?? []).map(
                  (attachment) => ({
                    id: attachment.id,
                    originalName: attachment.originalName,
                  }),
                ),
              }
            : null,
        };
      }),
      attachments: attachments
        .filter((attachment) => !attachment.requestMessageId)
        .map((attachment) => ({
          id: attachment.id,
          originalName: attachment.originalName,
          mimeType: attachment.mimeType,
          size: attachment.size,
          visibility: attachment.visibility,
          createdAt: attachment.createdAt,
        })),
    };
  });
}
