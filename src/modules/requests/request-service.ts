import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import type { Actor } from "@/lib/actor";
import { hasRolePermission } from "@/modules/authorization/role-permission-policy";
import { withActorDb } from "@/lib/actor";
import { writeAuditLog } from "@/modules/audit/audit-service";
import { dispatchRequestActivity } from "@/modules/notifications/notification-service";
import {
  createContentRiskReview,
  enforceActorPublicContentRules,
} from "@/modules/plugins/content-risk-service";
import {
  contentReeditDeadlineFor,
  contentRiskReasonFor,
  contentRiskStatusFor,
  loadContentRiskPageState,
} from "@/modules/plugins/content-risk-view-service";
import { badRequest, notFound } from "@/modules/requests/errors";
import { DomainError } from "@/modules/projects/errors";
import { generateRequestNumber } from "@/modules/requests/request-number";
import type { CreateRequestInput } from "@/modules/requests/request-schemas";
import {
  buildMessagePreview,
  escapeHtmlText,
  extractInlineAttachmentIds,
  hasMeaningfulHtml,
  isAttachmentOnlyBody,
} from "@/lib/message-content";
import {
  sanitizeMessageHtml,
  sanitizeReeditableMessageHtml,
} from "@/lib/sanitize-html";
import { claimUserInlineAttachments } from "@/modules/attachments/inline-attachment-service";
import { parseSupportPlaybookSnapshot } from "@/lib/support-reply-playbooks";
import {
  canViewProjectRequests,
  canViewRequest,
} from "@/modules/requests/request-permissions";
import { calculateRequestDueAt } from "@/modules/requests/request-sla";

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
  firstRespondedAt: true,
  dueAt: true,
  resolvedAt: true,
  closedAt: true,
  archivedAt: true,
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

export async function createRequest(
  actor: Actor,
  projectId: string,
  input: CreateRequestInput,
) {
  if (input.clientMutationKey) {
    const existing = await findRequestByMutationKey(
      actor,
      input.clientMutationKey,
      projectId,
    );
    if (existing) return existing;
  }
  const preflightProject = await withActorDb(actor, (tx) =>
    tx.project.findUnique({
      where: { id: projectId },
      select: { id: true, customerSpaceId: true },
    }),
  );
  if (preflightProject) {
    await enforceActorPublicContentRules(actor, {
      targetType: "SERVICE_REQUEST",
      customerSpaceId: preflightProject.customerSpaceId,
      projectId,
      serviceRequestId: null,
      snapshot: {
        title: input.title,
        body: input.description,
        visibility: "CUSTOMER_VISIBLE",
      },
    });
  }
  return withActorDb(actor, async (tx) => {
    const project = await tx.project.findUnique({
      where: { id: projectId },
      select: {
        id: true,
        status: true,
        serviceTypeId: true,
        serviceType: { select: { slaResolutionMinutes: true } },
        customerSpaceId: true,
        customerRequestsEnabled: true,
      },
    });
    if (!project) {
      throw notFound("项目不存在或无权访问");
    }
    if (!actor.isStaff && !project.customerRequestsEnabled) {
      throw badRequest("REQUESTS_DISABLED", "该项目未开放服务请求");
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
        clientMutationKey: input.clientMutationKey ?? null,
        dueAt: calculateRequestDueAt(
          project.serviceType.slaResolutionMinutes,
        ),
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
    await claimUserInlineAttachments(
      tx,
      actor,
      extractInlineAttachmentIds(sanitizedDescription),
      {
        projectId,
        serviceRequestId: request.id,
        requestMessageId: initialMessage.id,
        visibility: "CUSTOMER_VISIBLE",
      },
    );
    const contentRiskReview = await createContentRiskReview(tx, {
      targetType: "SERVICE_REQUEST",
      targetId: request.id,
      actorId: actor.id,
      actorName: actor.name,
      actorKind: actor.platformRole === "CUSTOMER" ? "CUSTOMER" : "STAFF",
      isPlatformAdmin: actor.isPlatformAdmin,
      customerSpaceId: project.customerSpaceId,
      projectId,
      serviceRequestId: request.id,
      snapshot: {
        title: input.title,
        body: sanitizedDescription,
        visibility: "CUSTOMER_VISIBLE",
        attachmentIds: extractInlineAttachmentIds(sanitizedDescription),
      },
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
    const delivery = await dispatchRequestActivity(tx, actor, {
      eventType: "REQUEST_CREATED",
      eventPayload: {
        projectId,
        requestId: request.id,
        requestNumber: request.number,
        actorId: actor.id,
        occurredAt: request.createdAt.toISOString(),
      },
      notificationType: "REQUEST_CREATED",
      notificationTitle: `${actor.name} 提交了请求 ${request.number}`,
      notificationBody: buildMessagePreview(sanitizedDescription),
      includeCustomers: true,
      notifyProjectManagers: true,
      notifyPlatformAdmins: true,
      customerSpaceId: project.customerSpaceId,
      projectId,
      serviceRequestId: request.id,
      contentRiskReviewId: contentRiskReview?.id,
    });
    const [summary] = await hydrateRequestSummaries(tx, [request]);
    return {
      ...summary,
      initialMessageId: initialMessage.id,
      deliveryFeedback: delivery.feedback,
    };
  }).catch(async (error: unknown) => {
    // 并发同 key：另一请求已创建，唯一约束兜底后返回已有记录
    if (input.clientMutationKey && isPrismaUniqueViolation(error)) {
      const existing = await findRequestByMutationKey(
        actor,
        input.clientMutationKey,
        projectId,
      );
      if (existing) return existing;
    }
    throw error;
  });
}

async function findRequestByMutationKey(
  actor: Actor,
  key: string,
  projectId: string,
) {
  return withActorDb(actor, async (tx) => {
    const request = await tx.serviceRequest.findUnique({
      where: {
        createdById_clientMutationKey: {
          createdById: actor.id,
          clientMutationKey: key,
        },
      },
      select: requestBaseSelect,
    });
    if (!request) return null;
    if (request.projectId !== projectId) {
      // 同 key 换项目重试：拒绝而非静默返回另一项目的工单
      throw new DomainError(
        "IDEMPOTENCY_KEY_CONFLICT",
        "重复提交标识与目标项目不一致，请刷新后重试",
        409,
      );
    }
    const initialMessage = await tx.requestMessage.findFirst({
      where: { serviceRequestId: request.id, isInitial: true },
      select: { id: true },
      orderBy: { createdAt: "asc" },
    });
    const [summary] = await hydrateRequestSummaries(tx, [request]);
    return {
      ...summary,
      initialMessageId: initialMessage?.id ?? "",
      deliveryFeedback: null,
    };
  });
}

function isPrismaUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

export function listProjectRequests(actor: Actor, projectId: string) {
  return withActorDb(actor, async (tx) => {
    const project = await tx.project.findUnique({
      where: { id: projectId },
      select: { id: true, customerRequestsEnabled: true },
    });
    if (!project) {
      throw notFound("项目不存在或无权访问");
    }
    if (!actor.isStaff && !project.customerRequestsEnabled) {
      return [];
    }
    const projectAssignment = actor.isStaff
      ? await tx.projectStaff.findUnique({
          where: { projectId_userId: { projectId, userId: actor.id } },
          select: { role: true },
        })
      : null;
    if (
      actor.isStaff &&
      !canViewProjectRequests(actor, projectAssignment?.role ?? null)
    ) {
      return [];
    }

    const restrictToAssigned =
      actor.isStaff &&
      !actor.isPlatformAdmin &&
      !hasRolePermission(actor, "request.view_project");

    const requests = await tx.serviceRequest.findMany({
      where: {
        projectId,
        ...(restrictToAssigned
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

export type ListRequestsForActorFilters = {
  projectId?: string;
  status?:
    | "PENDING"
    | "IN_PROGRESS"
    | "WAITING_CUSTOMER"
    | "RESOLVED"
    | "CLOSED";
  query?: string;
  priority?: "LOW" | "NORMAL" | "HIGH" | "URGENT";
  /** 归档范围：默认 EXCLUDE（不含归档），ONLY 只看归档，ALL 全部 */
  archived?: "EXCLUDE" | "ONLY" | "ALL";
  /** 仅看分配给我的（员工侧筛选，客户传了也无意义） */
  assignedToMe?: boolean;
  limit?: number;
  offset?: number;
};

// 跨项目工单列表（小程序/移动端入口）：可见范围沿用 RLS——tx.project.findMany
// 只会返回当前 Actor 有权访问的项目；客户额外受 customerRequestsEnabled 门控，
// 员工沿用 listProjectRequests 的「仅被分配/未分配」限制语义。
export function listRequestsForActor(
  actor: Actor,
  filters: ListRequestsForActorFilters = {},
) {
  const limit = Math.min(Math.max(filters.limit ?? 20, 1), 50);
  const offset = Math.max(filters.offset ?? 0, 0);
  return withActorDb(actor, async (tx) => {
    const projects = await tx.project.findMany({
      where: {
        ...(filters.projectId ? { id: filters.projectId } : {}),
        ...(actor.isStaff ? {} : { customerRequestsEnabled: { not: false } }),
      },
      select: { id: true, title: true },
    });
    const projectIds = projects.map((project) => project.id);
    if (projectIds.length === 0) {
      return { requests: [], nextOffset: null, totalVisibleProjects: 0 };
    }
    const projectTitleById = new Map(
      projects.map((project) => [project.id, project.title]),
    );

    const restrictToAssigned =
      actor.isStaff &&
      !actor.isPlatformAdmin &&
      !hasRolePermission(actor, "request.view_project");
    const keyword = filters.query?.trim();

    const requests = await tx.serviceRequest.findMany({
      where: {
        projectId: { in: projectIds },
        ...(filters.status ? { status: filters.status } : {}),
        ...(filters.priority ? { priority: filters.priority } : {}),
        // 归档默认不进列表：移动端列表没有归档分区，混进来会干扰日常处理
        ...(filters.archived === "ONLY"
          ? { archivedAt: { not: null } }
          : filters.archived === "ALL"
            ? {}
            : { archivedAt: null }),
        // 三组条件都是 OR，必须各自装进 AND 里：同一个对象字面量里重复写 OR
        // 后面的会覆盖前面的 —— 技术员不搜索时「仅我处理」被权限范围覆盖（仍看到
        // 未分配工单），任何人一输关键词又把前两组一起覆盖掉（权限范围也没了）。
        AND: [
          ...(filters.assignedToMe
            ? [
                {
                  OR: [
                    { assigneeId: actor.id },
                    { assignees: { some: { userId: actor.id } } },
                  ],
                },
              ]
            : []),
          ...(restrictToAssigned
            ? [
                {
                  OR: [
                    { assigneeId: actor.id },
                    { assignees: { some: { userId: actor.id } } },
                    { assigneeId: null, assignees: { none: {} } },
                  ],
                },
              ]
            : []),
          ...(keyword
            ? [
                {
                  OR: [
                    { title: { contains: keyword, mode: "insensitive" as const } },
                    { number: { contains: keyword, mode: "insensitive" as const } },
                  ],
                },
              ]
            : []),
        ],
      },
      select: requestBaseSelect,
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      skip: offset,
    });
    const hasMore = requests.length > limit;
    const page = hasMore ? requests.slice(0, limit) : requests;
    const summaries = await hydrateRequestSummaries(tx, page);
    return {
      // 跨项目列表附带项目名：员工端多项目并存时需要展示归属（客户端可忽略）
      requests: summaries.map((summary) => ({
        ...summary,
        project: {
          id: summary.projectId,
          title: projectTitleById.get(summary.projectId) ?? "",
        },
      })),
      nextOffset: hasMore ? offset + limit : null,
      totalVisibleProjects: projectIds.length,
    };
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
    const project = await tx.project.findUniqueOrThrow({
      where: { id: request.projectId },
      select: {
        id: true,
        title: true,
        customerSpaceId: true,
        customerRequestsEnabled: true,
      },
    });
    if (!actor.isStaff && !project.customerRequestsEnabled) {
      throw notFound();
    }
    if (actor.isStaff && !actor.isPlatformAdmin) {
      // 顺序执行：withActorDb 是单个 pg 连接，Promise.all 并发查询在 pg 上
      // 只是串行排队（重入警告，pg 9 起直接报错）
      const projectAssignment = await tx.projectStaff.findUnique({
        where: {
          projectId_userId: {
            projectId: request.projectId,
            userId: actor.id,
          },
        },
        select: { role: true },
      });
      const assignees = await tx.requestAssignee.findMany({
        where: { serviceRequestId: request.id },
        select: { userId: true },
      });
      if (
        !canViewRequest(actor, {
          assigneeId: request.assigneeId,
          assigneeIds: assignees.map((item) => item.userId),
          projectRole: projectAssignment?.role ?? null,
        })
      ) {
        throw notFound();
      }
    }
    const [summary] = await hydrateRequestSummaries(tx, [request]);
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
        supportPlaybookKey: true,
        supportPlaybookSnapshot: true,
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
        ...visibleContent,
      },
      select: {
        id: true,
        requestMessageId: true,
        originalName: true,
        title: true,
        note: true,
        previewStatus: true,
        mimeType: true,
        size: true,
        inline: true,
        visibility: true,
        uploadedById: true,
        createdAt: true,
      },
      orderBy: { createdAt: "asc" },
    });
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
    const requestRiskStatus = actor.isPlatformAdmin
      ? null
      : contentRiskStatusFor(riskState("SERVICE_REQUEST", request.id), {
          pluginEnabled: contentRisk.enabled,
          showPending: false,
        });
    const messageRiskState = (message: (typeof messages)[number]) =>
      message.isInitial
        ? riskState("SERVICE_REQUEST", request.id)
        : riskState("REQUEST_MESSAGE", message.id);
    const messageRiskStatus = (message: (typeof messages)[number]) =>
      contentRiskStatusFor(messageRiskState(message),
        {
          pluginEnabled: contentRisk.enabled,
          showPending:
            !actor.isPlatformAdmin &&
            (message.authorId === actor.id ||
              message.externalAuthorId === actor.id),
        },
      );
    const attachmentRiskStatus = (
      attachment: (typeof attachments)[number],
      parentStatus?: "PENDING" | "REVOKED" | null,
    ) => {
      if (actor.isPlatformAdmin) return null;
      if (parentStatus === "REVOKED") return "REVOKED" as const;
      return contentRiskStatusFor(riskState("ATTACHMENT", attachment.id), {
        pluginEnabled: contentRisk.enabled,
        showPending: attachment.uploadedById === actor.id,
      });
    };
    const authorFor = (message: (typeof messages)[number]) => ({
      author: message.authorId ? userById.get(message.authorId) ?? null : null,
      externalAuthor: message.externalAuthorId
        ? contactById.get(message.externalAuthorId) ?? null
        : null,
    });
    // 服务端权威判定「纯附件占位正文」：文件名无关的哨兵（见 isAttachmentOnlyBody），
    // 前端据此下发标志决定引用预览是否从实时附件列表重建，不再依赖正文里的文件名
    // （改名/撤回/部分上传失败都不影响判定）
    const isAttachmentPlaceholderBody = (
      message: (typeof messages)[number],
    ) => {
      const hasNonInline = (
        attachmentsByMessageId.get(message.id) ?? []
      ).some((attachment) => !attachment.inline);
      return isAttachmentOnlyBody(message.body, hasNonInline);
    };
    return {
      ...summary,
      project,
      description:
        requestRiskStatus === "REVOKED"
          ? "该内容已撤回"
          : summary.description,
      contentRiskUiEnabled: contentRisk.enabled,
      messages: messages.map((message) => {
        const contentRiskStatus = messageRiskStatus(message);
        const contentRiskReason = contentRiskReasonFor(
          messageRiskState(message),
        );
        // 重新编辑限管理员人工撤回之外、且在时限内（见 contentReeditDeadlineFor）：
        // 不满足时连撤回原文都不下发
        const reeditExpiresAt = contentReeditDeadlineFor(
          messageRiskState(message),
        );
        const canReeditRevokedMessage =
          contentRiskStatus === "REVOKED" &&
          (message.authorId === actor.id ||
            message.externalAuthorId === actor.id) &&
          reeditExpiresAt !== null;
        const replyTo = message.replyToMessageId
          ? messageById.get(message.replyToMessageId)
          : null;
        const replyToRiskStatus = replyTo ? messageRiskStatus(replyTo) : null;
        return {
          ...message,
          body:
            !actor.isPlatformAdmin && contentRiskStatus === "REVOKED"
              ? "该内容已撤回"
              : message.body,
          bodyIsAttachmentPlaceholder: isAttachmentPlaceholderBody(message),
          contentRiskStatus,
          contentRiskReason,
          reeditBody: canReeditRevokedMessage
            ? sanitizeReeditableMessageHtml(message.body)
            : null,
          reeditAttachmentCount: canReeditRevokedMessage
            ? (attachmentsByMessageId.get(message.id) ?? []).length
            : 0,
          reeditExpiresAt: canReeditRevokedMessage ? reeditExpiresAt : null,
          supportPlaybook:
            !actor.isPlatformAdmin && contentRiskStatus === "REVOKED"
              ? null
              : parseSupportPlaybookSnapshot(message.supportPlaybookSnapshot),
          author: authorFor(message).author,
          externalAuthor: authorFor(message).externalAuthor,
          attachments: (!actor.isPlatformAdmin && contentRiskStatus === "REVOKED"
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
              previewStatus: attachment.previewStatus,
              mimeType: attachment.mimeType,
              size: attachment.size,
              inline: attachment.inline,
              visibility: attachment.visibility,
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
                  !actor.isPlatformAdmin && replyToRiskStatus === "REVOKED"
                    ? "该内容已撤回"
                    : replyTo.body,
                bodyIsAttachmentPlaceholder:
                  isAttachmentPlaceholderBody(replyTo),
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
                attachments:
                  !actor.isPlatformAdmin && replyToRiskStatus === "REVOKED"
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
      }),
      attachments: (requestRiskStatus === "REVOKED" ? [] : attachments)
        .filter(
          (attachment) => !attachment.requestMessageId && !attachment.inline,
        )
        .map((attachment) => ({
          id: attachment.id,
          originalName: attachment.originalName,
          title: attachment.title,
          note: attachment.note,
          previewStatus: attachment.previewStatus,
          mimeType: attachment.mimeType,
          size: attachment.size,
          visibility: attachment.visibility,
          createdAt: attachment.createdAt,
          contentRiskStatus: attachmentRiskStatus(attachment),
        })),
    };
  });
}
