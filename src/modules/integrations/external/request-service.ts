import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import type { ExternalActor } from "@/lib/external-actor";
import { withExternalActorDb } from "@/lib/external-actor";
import {
  buildMessagePreview,
  escapeHtmlText,
  extractInlineAttachmentIds,
  hasMeaningfulHtml,
  htmlToPlainText,
} from "@/lib/message-content";
import {
  sanitizeMessageHtml,
  sanitizeReeditableMessageHtml,
} from "@/lib/sanitize-html";
import { parseSupportPlaybookSnapshot } from "@/lib/support-reply-playbooks";
import { claimExternalInlineAttachments } from "@/modules/attachments/inline-attachment-service";
import { writeExternalAuditLog } from "@/modules/audit/audit-service";
import {
  dispatchExternalRequestActivity,
} from "@/modules/notifications/notification-service";
import { DomainError } from "@/modules/projects/errors";
import { getRegisteredPlugin } from "@/modules/plugins/plugin-registry";
import {
  createContentRiskReview,
  enforceExternalPublicContentRules,
} from "@/modules/plugins/content-risk-service";
import {
  contentRiskReasonFor,
  contentRiskStatusFor,
  loadContentRiskPageState,
} from "@/modules/plugins/content-risk-view-service";
import { recordUniversalUnreadWebhook } from "@/modules/integrations/universal/webhook-service";
import { enqueueExternalRequestStatusMail } from "@/modules/integrations/external/mail-service";
import { generateRequestNumber } from "@/modules/requests/request-number";
import { calculateRequestDueAt } from "@/modules/requests/request-sla";
import {
  assertRequestTransition,
  statusAfterCustomerReply,
} from "@/modules/requests/request-state-machine";
import type {
  embedCreateRequestSchema,
  embedMessageSchema,
} from "@/modules/integrations/external/schemas";
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

type ExternalAuthorBrief = {
  id: string;
  externalUserId: string;
  displayName: string;
  email: string | null;
  username: string | null;
  avatarUrl: string | null;
  binding?: { pluginKey: string } | null;
};

function externalSource(pluginKey: string) {
  const manifest = getRegisteredPlugin(pluginKey).manifest;
  return {
    source:
      pluginKey === "universal-embed-connector"
        ? ("UNIVERSAL" as const)
        : ("SUB2API" as const),
    sourceKey: pluginKey,
    sourceLabel: manifest.name,
  };
}

function serializeAuthor(input: {
  author: Prisma.UserGetPayload<{ select: typeof userBriefSelect }> | null;
  externalAuthor: ExternalAuthorBrief | null;
}, fallback?: Pick<ExternalActor, "sourceKey" | "sourceLabel">) {
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
    const binding = (
      input.externalAuthor as typeof input.externalAuthor & {
        binding?: { pluginKey: string } | null;
      }
    ).binding;
    const pluginKey = binding?.pluginKey ?? fallback?.sourceKey ?? "sub2api-connector";
    const source = binding
      ? externalSource(pluginKey)
      : {
          source:
            pluginKey === "universal-embed-connector"
              ? ("UNIVERSAL" as const)
              : ("SUB2API" as const),
          sourceKey: pluginKey,
          sourceLabel: fallback?.sourceLabel ?? "外部接入",
        };
    return {
      id: input.externalAuthor.id,
      type: "EXTERNAL_CONTACT" as const,
      name: input.externalAuthor.displayName,
      email: input.externalAuthor.email,
      image: input.externalAuthor.avatarUrl,
      ...source,
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
      "当前项目只允许查看历史服务请求",
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
        serviceTypeId: true,
      },
    });
    if (!project) {
      throw new DomainError("PROJECT_NOT_FOUND", "项目不存在", 404);
    }
    const categories = await tx.requestCategory.findMany({
      where: { serviceTypeId: project.serviceTypeId, active: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });
    const requests = await tx.serviceRequest.findMany({
      where: {
        projectId: actor.projectId,
        createdByExternalContactId: actor.id,
        archivedAt: null,
      },
      select: {
        id: true,
        number: true,
        title: true,
        description: true,
        priority: true,
        status: true,
        firstRespondedAt: true,
        dueAt: true,
        createdAt: true,
        updatedAt: true,
        categoryId: true,
      },
      orderBy: { updatedAt: "desc" },
    });
    const readStates = await tx.externalRequestReadState.findMany({
      where: {
        externalContactId: actor.id,
        serviceRequestId: { in: requests.map((request) => request.id) },
      },
      select: { serviceRequestId: true, unreadCount: true },
    });
    const categoryById = new Map(categories.map((item) => [item.id, item]));
    const unreadByRequestId = new Map(
      readStates.map((item) => [item.serviceRequestId, item.unreadCount]),
    );
    const contentRisk = await loadContentRiskPageState([], tx);
    return {
      project: {
        id: project.id,
        title: project.title,
        status: project.status,
        writable: project.status === "ACTIVE",
      },
      categories,
      contentRiskUiEnabled: contentRisk.enabled,
      requests: requests.map((request) => ({
        ...request,
        category: categoryById.get(request.categoryId) ?? {
          id: request.categoryId,
          name: "分类已停用",
        },
        unreadCount: unreadByRequestId.get(request.id) ?? 0,
      })),
    };
  });
}

export async function createExternalRequest(
  actor: ExternalActor,
  input: CreateInput,
  options: { customerMemberNotificationsEnabled: boolean },
) {
  await enforceExternalPublicContentRules(actor, {
    targetType: "SERVICE_REQUEST",
    customerSpaceId: actor.customerSpaceId,
    projectId: actor.projectId,
    serviceRequestId: null,
    snapshot: {
      title: input.title,
      body: input.description,
      visibility: "CUSTOMER_VISIBLE",
    },
  });
  return withExternalActorDb(actor, async (tx) => {
    const project = await tx.project.findUnique({
      where: { id: actor.projectId },
      select: {
        id: true,
        title: true,
        kind: true,
        status: true,
        serviceTypeId: true,
        serviceType: { select: { slaResolutionMinutes: true } },
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
        dueAt: calculateRequestDueAt(
          project.serviceType.slaResolutionMinutes,
        ),
      },
      select: {
        id: true,
        number: true,
        title: true,
        description: true,
        priority: true,
        status: true,
        firstRespondedAt: true,
        dueAt: true,
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
    const contentRiskReview = await createContentRiskReview(tx, {
      targetType: "SERVICE_REQUEST",
      targetId: request.id,
      actorId: actor.id,
      actorName: actor.name,
      actorKind: "EXTERNAL",
      isPlatformAdmin: false,
      customerSpaceId: project.customerSpaceId,
      projectId: project.id,
      serviceRequestId: request.id,
      snapshot: {
        title: request.title,
        body: description,
        visibility: "CUSTOMER_VISIBLE",
        attachmentIds: extractInlineAttachmentIds(description),
      },
    });
    await writeExternalAuditLog(tx, actor, {
      action: "REQUEST_CREATED",
      resourceType: "ServiceRequest",
      resourceId: request.id,
      serviceRequestId: request.id,
      metadata: {
        actorType: "EXTERNAL_CONTACT",
        source: actor.sourceKey ?? "sub2api-connector",
        categoryId: category.id,
        priority: request.priority,
      },
    });
    await dispatchExternalRequestActivity(tx, actor, {
      eventType: "REQUEST_CREATED",
      eventPayload: {
        actorType: "EXTERNAL_CONTACT",
        source: actor.sourceKey ?? "sub2api-connector",
        actorId: actor.id,
        projectId: project.id,
        requestId: request.id,
        requestNumber: request.number,
        occurredAt: request.createdAt.toISOString(),
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
      contentRiskReviewId: contentRiskReview?.id,
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
        firstRespondedAt: true,
        dueAt: true,
        resolvedAt: true,
        closedAt: true,
        archivedAt: true,
        createdAt: true,
        updatedAt: true,
        categoryId: true,
        projectId: true,
      },
    });
    if (!request) {
      throw new DomainError("REQUEST_NOT_FOUND", "服务请求不存在", 404);
    }
    const category = await tx.requestCategory.findUniqueOrThrow({
      where: { id: request.categoryId },
      select: { id: true, name: true },
    });
    const project = await tx.project.findUniqueOrThrow({
      where: { id: request.projectId },
      select: { id: true, title: true, status: true },
    });
    const assigneeRows = await tx.requestAssignee.findMany({
      where: { serviceRequestId: request.id },
      select: { userId: true },
      orderBy: { assignedAt: "asc" },
    });
    const messages = await tx.requestMessage.findMany({
      where: {
        serviceRequestId: request.id,
        visibility: "CUSTOMER_VISIBLE",
      },
      select: {
        id: true,
        body: true,
        visibility: true,
        isSystem: true,
        isInitial: true,
        replyToMessageId: true,
        authorId: true,
        externalAuthorId: true,
        supportPlaybookKey: true,
        supportPlaybookSnapshot: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    const userIds = Array.from(
      new Set(
        [
          ...assigneeRows.map((item) => item.userId),
          ...messages.map((message) => message.authorId),
        ].filter((value): value is string => Boolean(value)),
      ),
    );
    const users = await tx.user.findMany({
      where: { id: { in: userIds } },
      select: userBriefSelect,
    });
    const contactIds = Array.from(
      new Set(
        messages
          .map((message) => message.externalAuthorId)
          .filter((value): value is string => Boolean(value)),
      ),
    );
    const contacts = await tx.externalContact.findMany({
      where: { id: { in: contactIds } },
      select: {
        id: true,
        bindingId: true,
        externalUserId: true,
        displayName: true,
        email: true,
        username: true,
        avatarUrl: true,
        status: true,
      },
    });
    const bindings = await tx.projectPluginBinding.findMany({
      where: { id: { in: contacts.map((contact) => contact.bindingId) } },
      select: { id: true, pluginKey: true },
    });
    const playbookAssetIdsByMessageId = new Map(
      messages.map((message) => {
        const snapshot = parseSupportPlaybookSnapshot(
          message.supportPlaybookSnapshot,
        );
        return [
          message.id,
          snapshot?.content
            ? extractInlineAttachmentIds(snapshot.content)
            : [],
        ] as const;
      }),
    );
    const supportPlaybookAssetIds = Array.from(
      new Set(Array.from(playbookAssetIdsByMessageId.values()).flat()),
    );
    const attachments = await tx.attachment.findMany({
      where: {
        OR: [
          { serviceRequestId: request.id },
          { id: { in: supportPlaybookAssetIds } },
        ],
        visibility: "CUSTOMER_VISIBLE",
      },
      select: {
        id: true,
        requestMessageId: true,
        originalName: true,
        title: true,
        note: true,
        mimeType: true,
        size: true,
        inline: true,
        uploadedByExternalContactId: true,
        createdAt: true,
      },
      orderBy: { createdAt: "asc" },
    });
    const readState = await tx.externalRequestReadState.findUnique({
      where: {
        serviceRequestId_externalContactId: {
          serviceRequestId: request.id,
          externalContactId: actor.id,
        },
      },
      select: { unreadCount: true },
    });
    const previousUnreadCount = readState?.unreadCount ?? 0;
    if (previousUnreadCount > 0) {
      await tx.externalRequestReadState.upsert({
        where: {
          serviceRequestId_externalContactId: {
            serviceRequestId: request.id,
            externalContactId: actor.id,
          },
        },
        create: {
          serviceRequestId: request.id,
          externalContactId: actor.id,
          unreadCount: 0,
          lastReadAt: new Date(),
        },
        update: { unreadCount: 0, lastReadAt: new Date() },
      });
      await recordUniversalUnreadWebhook(tx, {
        serviceRequestId: request.id,
        externalUserId: actor.externalUserId,
        unreadCount: 0,
      });
    }
    const userById = new Map(users.map((user) => [user.id, user]));
    const pluginKeyByBindingId = new Map(
      bindings.map((binding) => [binding.id, binding.pluginKey]),
    );
    const contactById = new Map(
      contacts.map((contact) => [
        contact.id,
        {
          id: contact.id,
          externalUserId: contact.externalUserId,
          displayName: contact.displayName,
          email: contact.email,
          username: contact.username,
          avatarUrl: contact.avatarUrl,
          status: contact.status,
          binding: {
            pluginKey:
              pluginKeyByBindingId.get(contact.bindingId) ??
              actor.sourceKey ??
              "sub2api-connector",
          },
        },
      ]),
    );
    const attachmentsByMessageId = new Map<string, typeof attachments>();
    const attachmentById = new Map(
      attachments.map((attachment) => [attachment.id, attachment]),
    );
    for (const attachment of attachments) {
      if (attachment.requestMessageId) {
        const current = attachmentsByMessageId.get(attachment.requestMessageId) ?? [];
        current.push(attachment);
        attachmentsByMessageId.set(attachment.requestMessageId, current);
      }
    }
    const messageById = new Map(messages.map((message) => [message.id, message]));
    const contentRisk = await loadContentRiskPageState(
      [
        { targetType: "SERVICE_REQUEST", targetId: request.id },
        ...messages.map((message) => ({
          targetType: "REQUEST_MESSAGE" as const,
          targetId: message.id,
        })),
        ...attachments.map((attachment) => ({
          targetType: "ATTACHMENT" as const,
          targetId: attachment.id,
        })),
      ],
      tx,
    );
    const riskState = (
      targetType: "SERVICE_REQUEST" | "REQUEST_MESSAGE" | "ATTACHMENT",
      targetId: string,
    ) => contentRisk.states.get(`${targetType}:${targetId}`);
    const requestRiskStatus = contentRiskStatusFor(
      riskState("SERVICE_REQUEST", request.id),
      { pluginEnabled: contentRisk.enabled, showPending: false },
    );
    const messageRiskState = (message: (typeof messages)[number]) =>
      message.isInitial
        ? riskState("SERVICE_REQUEST", request.id)
        : riskState("REQUEST_MESSAGE", message.id);
    const messageRiskStatus = (message: (typeof messages)[number]) =>
      contentRiskStatusFor(messageRiskState(message),
        {
          pluginEnabled: contentRisk.enabled,
          showPending: message.externalAuthorId === actor.id,
        },
      );
    const attachmentRiskStatus = (
      attachment: (typeof attachments)[number],
      parentStatus?: "PENDING" | "REVOKED" | null,
    ) => {
      if (parentStatus === "REVOKED") return "REVOKED" as const;
      return contentRiskStatusFor(riskState("ATTACHMENT", attachment.id), {
        pluginEnabled: contentRisk.enabled,
        showPending: attachment.uploadedByExternalContactId === actor.id,
      });
    };
    const authorFor = (message: (typeof messages)[number]) => ({
      author: message.authorId ? userById.get(message.authorId) ?? null : null,
      externalAuthor: message.externalAuthorId
        ? contactById.get(message.externalAuthorId) ?? null
        : null,
    });
    // 与客户/员工序列化一致：服务端权威判定「纯附件占位正文」
    const isAttachmentPlaceholderBody = (
      message: (typeof messages)[number],
    ) => {
      const files = (attachmentsByMessageId.get(message.id) ?? []).filter(
        (attachment) => !attachment.inline,
      );
      if (files.length === 0) return false;
      return (
        htmlToPlainText(message.body).trim() ===
        `附件：${files.map((attachment) => attachment.originalName).join("、")}`
      );
    };
    const serializedMessages = messages.map((message) => {
      const contentRiskStatus = messageRiskStatus(message);
      const contentRiskReason = contentRiskReasonFor(
        messageRiskState(message),
      );
      const canReeditRevokedMessage =
        contentRiskStatus === "REVOKED" &&
        message.externalAuthorId === actor.id;
      const replyTo = message.replyToMessageId
        ? messageById.get(message.replyToMessageId)
        : null;
      const replyToRiskStatus = replyTo ? messageRiskStatus(replyTo) : null;
      return {
        id: message.id,
        body:
          contentRiskStatus === "REVOKED" ? "该内容已撤回" : message.body,
        bodyIsAttachmentPlaceholder: isAttachmentPlaceholderBody(message),
        visibility: message.visibility,
        isSystem: message.isSystem,
        isInitial: message.isInitial,
        supportPlaybook:
          contentRiskStatus === "REVOKED"
            ? null
            : parseSupportPlaybookSnapshot(message.supportPlaybookSnapshot),
        replyToMessageId: message.replyToMessageId,
        createdAt: message.createdAt,
        updatedAt: message.updatedAt,
        contentRiskStatus,
        contentRiskReason,
        reeditBody: canReeditRevokedMessage
          ? sanitizeReeditableMessageHtml(message.body)
          : null,
        reeditAttachmentCount: canReeditRevokedMessage
          ? (attachmentsByMessageId.get(message.id) ?? []).length
          : 0,
        author: serializeAuthor(authorFor(message), actor),
        attachments: (contentRiskStatus === "REVOKED"
          ? []
          : [
              ...(attachmentsByMessageId.get(message.id) ?? []),
              ...(playbookAssetIdsByMessageId.get(message.id) ?? [])
                .map((id) => attachmentById.get(id))
                .filter(
                  (value): value is (typeof attachments)[number] =>
                    Boolean(value),
                ),
            ]).map(
          (attachment) => ({
            id: attachment.id,
            originalName: attachment.originalName,
            title: attachment.title,
            note: attachment.note,
            mimeType: attachment.mimeType,
            size: attachment.size,
            inline: attachment.inline,
            createdAt: attachment.createdAt,
            contentRiskStatus: attachmentRiskStatus(
              attachment,
              contentRiskStatus,
            ),
          }),
        ),
        replyTo: replyTo
          ? {
              id: replyTo.id,
              body:
                replyToRiskStatus === "REVOKED"
                  ? "该内容已撤回"
                  : replyTo.body,
              bodyIsAttachmentPlaceholder: isAttachmentPlaceholderBody(replyTo),
              visibility: replyTo.visibility,
              isSystem: replyTo.isSystem,
              author: serializeAuthor(authorFor(replyTo), actor),
              attachments:
                replyToRiskStatus === "REVOKED"
                  ? []
                  : (attachmentsByMessageId.get(replyTo.id) ?? [])
                      // 单个附件被风控撤回时，引用预览也不能带出其文件名/标题
                      .filter(
                        (attachment) =>
                          attachmentRiskStatus(attachment) !== "REVOKED",
                      )
                      .map((attachment) => ({
                        id: attachment.id,
                        originalName: attachment.originalName,
                        title: attachment.title,
                        inline: attachment.inline,
                      })),
            }
          : null,
      };
    });
    return {
      ...request,
      description:
        requestRiskStatus === "REVOKED"
          ? "该内容已撤回"
          : request.description,
      category,
      project,
      contentRiskUiEnabled: contentRisk.enabled,
      assignees: assigneeRows
        .map((item) => userById.get(item.userId))
        .filter((user): user is NonNullable<typeof user> => Boolean(user))
        .map((user) => ({ user })),
      attachments: (requestRiskStatus === "REVOKED" ? [] : attachments)
        .filter(
          (attachment) => !attachment.requestMessageId && !attachment.inline,
        )
        .map((attachment) => ({
          id: attachment.id,
          originalName: attachment.originalName,
          title: attachment.title,
          note: attachment.note,
          mimeType: attachment.mimeType,
          size: attachment.size,
          createdAt: attachment.createdAt,
          contentRiskStatus: attachmentRiskStatus(attachment),
        })),
      unreadCount: 0,
      writable:
        project.status === "ACTIVE" &&
        request.status !== "CLOSED" &&
        !request.archivedAt,
      messages: serializedMessages,
    };
  });
}

export async function addExternalRequestMessage(
  actor: ExternalActor,
  requestId: string,
  input: MessageInput,
  options: { customerMemberNotificationsEnabled: boolean },
) {
  const preflightRequest = await withExternalActorDb(actor, (tx) =>
    tx.serviceRequest.findFirst({
      where: {
        id: requestId,
        projectId: actor.projectId,
        createdByExternalContactId: actor.id,
      },
      select: { id: true, projectId: true },
    }),
  );
  if (preflightRequest) {
    await enforceExternalPublicContentRules(actor, {
      targetType: "REQUEST_MESSAGE",
      customerSpaceId: actor.customerSpaceId,
      projectId: preflightRequest.projectId,
      serviceRequestId: preflightRequest.id,
      snapshot: { body: input.body, visibility: "CUSTOMER_VISIBLE" },
    });
  }
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
        archivedAt: true,
        assigneeId: true,
        assignees: { select: { userId: true } },
        project: {
          select: { id: true, status: true, customerSpaceId: true },
        },
      },
    });
    if (!request) {
      throw new DomainError("REQUEST_NOT_FOUND", "服务请求不存在", 404);
    }
    ensureProjectWritable(request.project.status);
    if (request.archivedAt) {
      throw new DomainError(
        "REQUEST_ARCHIVED",
        "当前服务请求已归档，只允许查看历史内容",
        409,
      );
    }
    if (request.status === "CLOSED") {
      throw new DomainError("REQUEST_CLOSED", "已关闭的服务请求不能回复", 409);
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
    await claimExternalInlineAttachments(
      tx,
      actor,
      extractInlineAttachmentIds(body),
      {
        projectId: request.project.id,
        serviceRequestId: request.id,
        requestMessageId: message.id,
      },
    );
    const contentRiskReview = await createContentRiskReview(tx, {
      targetType: "REQUEST_MESSAGE",
      targetId: message.id,
      actorId: actor.id,
      actorName: actor.name,
      actorKind: "EXTERNAL",
      isPlatformAdmin: false,
      customerSpaceId: request.project.customerSpaceId,
      projectId: request.project.id,
      serviceRequestId: request.id,
      snapshot: {
        body,
        visibility: "CUSTOMER_VISIBLE",
        attachmentIds: extractInlineAttachmentIds(body),
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
          "服务请求状态已变更，请刷新后重试",
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
        source: actor.sourceKey ?? "sub2api-connector",
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
        source: actor.sourceKey ?? "sub2api-connector",
        actorId: actor.id,
        requestId: request.id,
        requestNumber: request.number,
        messageId: message.id,
        visibility: "CUSTOMER_VISIBLE",
        occurredAt: message.createdAt.toISOString(),
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
      sourceType: "REQUEST_MESSAGE",
      sourceId: message.id,
      contentRiskReviewId: contentRiskReview?.id,
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
        audible: false,
        customerSpaceId: request.project.customerSpaceId,
        projectId: request.project.id,
        serviceRequestId: request.id,
      });
    }
    return { message, requestStatus: nextStatus };
  });
}


export async function confirmExternalRequestClosed(
  actor: ExternalActor,
  requestId: string,
) {
  const result = await withExternalActorDb(actor, async (tx) => {
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
        archivedAt: true,
        assigneeId: true,
        assignees: { select: { userId: true } },
        project: {
          select: { id: true, status: true, customerSpaceId: true, title: true },
        },
      },
    });
    if (!request) {
      throw new DomainError("REQUEST_NOT_FOUND", "服务请求不存在", 404);
    }
    ensureProjectWritable(request.project.status);
    if (request.archivedAt) {
      throw new DomainError(
        "REQUEST_ARCHIVED",
        "当前服务请求已归档，只允许查看历史内容",
        409,
      );
    }
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
        "服务请求状态已变更，请刷新后重试",
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
        source: actor.sourceKey ?? "sub2api-connector",
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
      relevantWorkerUserIds: Array.from(
        new Set(
          [request.assigneeId, ...request.assignees.map((item) => item.userId)].filter(
            (value): value is string => Boolean(value),
          ),
        ),
      ),
      notifyProjectManagers: true,
      notifyPlatformAdmins: true,
      customerSpaceId: request.project.customerSpaceId,
      projectId: request.project.id,
      serviceRequestId: request.id,
    });
    return updated;
  });
  await enqueueExternalRequestStatusMail(requestId, "CLOSED");
  return result;
}
