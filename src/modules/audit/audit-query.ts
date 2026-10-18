import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import type { Actor } from "@/lib/actor";
import { withActorDb } from "@/lib/actor";
import {
  auditActionLabel,
  auditResourceLabel,
  auditResultLabel,
  isUnauthenticatedAuditAction,
} from "@/modules/audit/audit-labels";
import {
  auditCategoryFor,
  auditCategoryLabel,
  buildAuditPresentation,
  describeUserAgent,
  ipScopeFor,
  PLATFORM_ROLE_LABELS,
  platformRoleLabel,
} from "@/modules/audit/audit-presentation";
import type {
  AuditActorKind,
  AuditActorView,
  AuditCategoryKey,
  AuditFacets,
  AuditLogRow,
  AuditObjectView,
} from "@/modules/audit/audit-types";
import { assertAllowed } from "@/modules/projects/errors";

export const AUDIT_PAGE_SIZE_MAX = 100;

export type AuditLogFilters = {
  action?: string;
  resourceType?: string;
  actorId?: string;
  result?: string;
  category?: AuditCategoryKey;
  from?: Date;
  to?: Date;
  search?: string;
  page?: number;
  pageSize?: number;
};

export type AuditLogPage = {
  rows: AuditLogRow[];
  total: number;
  page: number;
  pageSize: number;
};

export type { AuditFacets, AuditLogRow };

export const auditRecordSelect = {
  id: true,
  action: true,
  resourceType: true,
  resourceId: true,
  result: true,
  metadata: true,
  ipAddress: true,
  userAgent: true,
  createdAt: true,
  projectId: true,
  customerSpaceId: true,
  serviceRequestId: true,
  actor: {
    select: {
      id: true,
      name: true,
      email: true,
      platformRole: true,
      roleGroup: { select: { name: true } },
    },
  },
  externalActor: { select: { id: true, displayName: true } },
} satisfies Prisma.AuditLogSelect;

type AuditRecord = Prisma.AuditLogGetPayload<{ select: typeof auditRecordSelect }>;

type ReferenceMaps = {
  requests: Map<string, { number: string; title: string }>;
  projects: Map<string, { title: string }>;
  spaces: Map<string, { name: string }>;
  users: Map<string, { name: string; email: string }>;
  milestones: Map<string, { title: string }>;
  projectUpdates: Map<string, { title: string }>;
  externalContacts: Map<string, { displayName: string }>;
  roleGroups: Map<string, { name: string }>;
};

const EMPTY_REFERENCES: ReferenceMaps = {
  requests: new Map(),
  projects: new Map(),
  spaces: new Map(),
  users: new Map(),
  milestones: new Map(),
  projectUpdates: new Map(),
  externalContacts: new Map(),
  roleGroups: new Map(),
};

const METADATA_USER_KEYS = [
  "userId",
  "assigneeId",
  "previousAssigneeId",
  "ownerId",
  "requestedById",
  "targetUserId",
];

const METADATA_USER_ARRAY_KEYS = [
  "managerUserIds",
  "assigneeIds",
  "previousAssigneeIds",
  "emailPreferenceOverriddenUserIds",
  "excludedUserIds",
];

function metadataRecord(metadata: Prisma.JsonValue | null): Record<string, unknown> {
  return metadata && typeof metadata === "object" && !Array.isArray(metadata)
    ? (metadata as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

/** 把一页记录里引用到的资源一次性查出来，避免逐行 N+1。 */
export async function loadAuditReferences(
  tx: Prisma.TransactionClient,
  records: AuditRecord[],
): Promise<ReferenceMaps> {
  if (records.length === 0) return EMPTY_REFERENCES;

  const requestIds = new Set<string>();
  const projectIds = new Set<string>();
  const spaceIds = new Set<string>();
  const userIds = new Set<string>();
  const milestoneIds = new Set<string>();
  const projectUpdateIds = new Set<string>();
  const externalContactIds = new Set<string>();
  const roleGroupIds = new Set<string>();

  for (const record of records) {
    if (record.serviceRequestId) requestIds.add(record.serviceRequestId);
    if (record.projectId) projectIds.add(record.projectId);
    if (record.customerSpaceId) spaceIds.add(record.customerSpaceId);

    const metadata = metadataRecord(record.metadata);
    for (const key of METADATA_USER_KEYS) {
      const value = stringValue(metadata[key]);
      if (value) userIds.add(value);
    }
    for (const key of METADATA_USER_ARRAY_KEYS) {
      const value = metadata[key];
      if (Array.isArray(value)) {
        for (const item of value) {
          const id = stringValue(item);
          if (id) userIds.add(id);
        }
      }
    }

    switch (record.resourceType) {
      case "ServiceRequest":
        if (record.resourceId) requestIds.add(record.resourceId);
        break;
      case "Project":
        if (record.resourceId) projectIds.add(record.resourceId);
        break;
      case "CustomerSpace":
        if (record.resourceId) spaceIds.add(record.resourceId);
        break;
      case "User":
        // 只有 User 动作的 resourceId 才是用户 id；WechatBinding/Code 与
        // UserEmailChange 的 resourceId 是绑定/变更记录 id，用户 id 在 metadata.userId。
        if (record.resourceId) userIds.add(record.resourceId);
        break;
      case "Milestone":
        if (record.resourceId) milestoneIds.add(record.resourceId);
        break;
      case "ProjectUpdate":
        if (record.resourceId) projectUpdateIds.add(record.resourceId);
        break;
      case "ExternalContact":
        if (record.resourceId) externalContactIds.add(record.resourceId);
        break;
      case "RoleGroup":
        if (record.resourceId) roleGroupIds.add(record.resourceId);
        break;
      default:
        break;
    }

    // 评论类动作的对象是里程碑/进度，id 藏在 metadata 里
    const metadataMilestoneId = stringValue(metadata.milestoneId);
    if (metadataMilestoneId) milestoneIds.add(metadataMilestoneId);
    const metadataUpdateId = stringValue(metadata.projectUpdateId);
    if (metadataUpdateId) projectUpdateIds.add(metadataUpdateId);
    const metadataRoleGroupId = stringValue(metadata.roleGroupId);
    if (metadataRoleGroupId) roleGroupIds.add(metadataRoleGroupId);
  }

  // 事务内只有一个连接：顺序执行，避免 pg 的重入问题
  const requests = requestIds.size
    ? await tx.serviceRequest.findMany({
        where: { id: { in: [...requestIds] } },
        select: { id: true, number: true, title: true },
      })
    : [];
  const projects = projectIds.size
    ? await tx.project.findMany({
        where: { id: { in: [...projectIds] } },
        select: { id: true, title: true },
      })
    : [];
  const spaces = spaceIds.size
    ? await tx.customerSpace.findMany({
        where: { id: { in: [...spaceIds] } },
        select: { id: true, name: true },
      })
    : [];
  const users = userIds.size
    ? await tx.user.findMany({
        where: { id: { in: [...userIds] } },
        select: { id: true, name: true, email: true },
      })
    : [];
  const milestones = milestoneIds.size
    ? await tx.milestone.findMany({
        where: { id: { in: [...milestoneIds] } },
        select: { id: true, title: true },
      })
    : [];
  const projectUpdates = projectUpdateIds.size
    ? await tx.projectUpdate.findMany({
        where: { id: { in: [...projectUpdateIds] } },
        select: { id: true, title: true },
      })
    : [];
  const externalContacts = externalContactIds.size
    ? await tx.externalContact.findMany({
        where: { id: { in: [...externalContactIds] } },
        select: { id: true, displayName: true },
      })
    : [];
  const roleGroups = roleGroupIds.size
    ? await tx.roleGroup.findMany({
        where: { id: { in: [...roleGroupIds] } },
        select: { id: true, name: true },
      })
    : [];

  return {
    requests: new Map(requests.map((item) => [item.id, item])),
    projects: new Map(projects.map((item) => [item.id, item])),
    spaces: new Map(spaces.map((item) => [item.id, item])),
    users: new Map(users.map((item) => [item.id, item])),
    milestones: new Map(milestones.map((item) => [item.id, item])),
    projectUpdates: new Map(projectUpdates.map((item) => [item.id, item])),
    externalContacts: new Map(externalContacts.map((item) => [item.id, item])),
    roleGroups: new Map(roleGroups.map((item) => [item.id, item])),
  };
}

function requestObject(
  references: ReferenceMaps,
  id: string | null,
): AuditObjectView | null {
  if (!id) return null;
  const request = references.requests.get(id);
  if (!request) return null;
  const label = `#${request.number} ${request.title}`.trim();
  return { label, typeLabel: "工单", href: `/staff/requests/${id}` };
}

function projectObject(
  references: ReferenceMaps,
  id: string | null,
): AuditObjectView | null {
  if (!id) return null;
  const project = references.projects.get(id);
  if (!project) return null;
  return { label: project.title, typeLabel: "项目", href: `/staff/projects/${id}` };
}

function spaceObject(
  references: ReferenceMaps,
  id: string | null,
): AuditObjectView | null {
  if (!id) return null;
  const space = references.spaces.get(id);
  if (!space) return null;
  return { label: space.name, typeLabel: "客户空间", href: null };
}

function userObject(
  references: ReferenceMaps,
  id: string | null,
): AuditObjectView | null {
  if (!id) return null;
  const user = references.users.get(id);
  if (!user) return null;
  return { label: user.name, typeLabel: "用户", href: null };
}

function namedObject(
  label: string | null,
  typeLabel: string,
): AuditObjectView | null {
  return label ? { label, typeLabel, href: null } : null;
}

function metadataLabel(metadata: Record<string, unknown>): string | null {
  return (
    stringValue(metadata.title) ??
    stringValue(metadata.name) ??
    stringValue(metadata.originalName) ??
    stringValue(metadata.key) ??
    stringValue(metadata.pluginKey) ??
    stringValue(metadata.templateKey)
  );
}

/** 动作本身指向「自己」时，对象列与执行人重复，直接不展示对象。 */
const SELF_ACTIONS = new Set([
  "USER_LOGIN",
  "USER_LOGOUT",
  "PROFILE_UPDATED",
  "PROFILE_AVATAR_UPDATED",
  "APPEARANCE_PREFERENCE_UPDATED",
  "NOTIFICATION_PREFERENCES_UPDATED",
  "NOTIFICATION_PREFERENCE_TYPE_UPDATED",
]);

function resolveAuditObject(
  record: AuditRecord,
  references: ReferenceMaps,
): { object: AuditObjectView | null; scope: AuditObjectView | null } {
  const metadata = metadataRecord(record.metadata);
  const request = requestObject(references, record.serviceRequestId);
  const project = projectObject(references, record.projectId);
  const space = spaceObject(references, record.customerSpaceId);
  const resourceLabel = auditResourceLabel(record.resourceType);

  if (SELF_ACTIONS.has(record.action)) {
    return { object: null, scope: project ?? space };
  }

  switch (record.resourceType) {
    case "ServiceRequest":
      return {
        // 旧记录可能只填了 resourceId，没填 serviceRequestId
        object:
          request ??
          requestObject(references, record.resourceId) ??
          namedObject(metadataLabel(metadata), resourceLabel),
        scope: project,
      };
    case "RequestMessage":
      return {
        object: request ?? namedObject(metadataLabel(metadata), resourceLabel),
        scope: project,
      };
    case "Project":
      return {
        object:
          project ??
          projectObject(references, record.resourceId) ??
          namedObject(metadataLabel(metadata), resourceLabel),
        scope: space,
      };
    case "ProjectStaff":
      return { object: project, scope: space };
    case "Milestone":
      return {
        object:
          namedObject(
            record.resourceId
              ? references.milestones.get(record.resourceId)?.title ?? null
              : null,
            "里程碑",
          ) ?? namedObject(metadataLabel(metadata), "里程碑"),
        scope: project,
      };
    case "MilestoneComment":
      return {
        object: namedObject(
          stringValue(metadata.milestoneId)
            ? references.milestones.get(stringValue(metadata.milestoneId) ?? "")?.title ?? null
            : null,
          "里程碑",
        ),
        scope: project,
      };
    case "ProjectUpdate":
      return {
        object:
          projectUpdateObject(references, record.resourceId) ??
          namedObject(metadataLabel(metadata), "项目进度"),
        scope: project,
      };
    case "UpdateComment":
      return {
        object: projectUpdateObject(
          references,
          stringValue(metadata.projectUpdateId),
        ),
        scope: project,
      };
    case "Attachment": {
      const fileName = stringValue(metadata.originalName);
      return {
        object: namedObject(fileName, "附件"),
        scope: project ?? request ?? space,
      };
    }
    case "CustomerSpace":
      return {
        object:
          space ??
          spaceObject(references, record.resourceId) ??
          namedObject(metadataLabel(metadata), resourceLabel),
        scope: null,
      };
    case "Membership":
    case "Invitation":
      return {
        object:
          space ??
          namedObject(
            stringValue(metadata.email) ?? metadataLabel(metadata),
            resourceLabel,
          ),
        scope: null,
      };
    case "User":
      return {
        object:
          userObject(references, record.resourceId) ??
          namedObject(stringValue(metadata.email), "账号"),
        scope: space,
      };
    case "UserNotificationPreference":
      return { object: null, scope: null };
    case "UserEmailChange":
    case "WechatBinding":
    case "WechatBindingCode":
      return {
        object:
          userObject(references, stringValue(metadata.userId)) ??
          namedObject(stringValue(metadata.email), "账号"),
        scope: space,
      };
    case "ExternalContact":
      return {
        object:
          namedObject(
            record.resourceId
              ? references.externalContacts.get(record.resourceId)?.displayName ?? null
              : null,
            "外部联系人",
          ) ?? namedObject(metadataLabel(metadata), "外部联系人"),
        scope: null,
      };
    case "RoleGroup":
      return {
        object:
          namedObject(
            record.resourceId
              ? references.roleGroups.get(record.resourceId)?.name ?? null
              : null,
            "权限组",
          ) ?? namedObject(metadataLabel(metadata), "权限组"),
        scope: null,
      };
    case "PlatformSetting":
    case "SystemErrorLog":
      return { object: null, scope: null };
    default:
      return {
        object:
          namedObject(metadataLabel(metadata), resourceLabel) ??
          project ??
          space ??
          request,
        scope: namedObject(metadataLabel(metadata), resourceLabel) ? project ?? space : null,
      };
  }
}

function projectUpdateObject(
  references: ReferenceMaps,
  id: string | null,
): AuditObjectView | null {
  if (!id) return null;
  const update = references.projectUpdates.get(id);
  return update ? namedObject(update.title, "项目进度") : null;
}

function actorView(record: AuditRecord): AuditActorView {
  if (record.actor) {
    return {
      kind: "USER",
      id: record.actor.id,
      name: record.actor.name,
      email: record.actor.email,
      roleLabel:
        record.actor.roleGroup?.name ??
        platformRoleLabel(record.actor.platformRole) ??
        null,
    };
  }
  if (record.externalActor) {
    return {
      kind: "EXTERNAL",
      id: record.externalActor.id,
      name: record.externalActor.displayName,
      email: null,
      roleLabel: "外部联系人",
    };
  }
  if (isUnauthenticatedAuditAction(record.action)) {
    const email = stringValue(metadataRecord(record.metadata).email);
    return {
      kind: "ANONYMOUS",
      id: null,
      name: "未认证访客",
      email,
      roleLabel: "未登录尝试",
    };
  }
  return {
    kind: "SYSTEM",
    id: null,
    name: "系统",
    email: null,
    roleLabel: "自动任务",
  };
}

function legacyActorDisplay(actor: AuditActorView): { name: string; secondary: string } {
  switch (actor.kind) {
    case "USER":
      return { name: actor.name, secondary: actor.email ?? "—" };
    case "EXTERNAL":
      return { name: actor.name, secondary: "外部联系人" };
    case "ANONYMOUS":
      return { name: "未认证访客", secondary: "未登录尝试" };
    default:
      return { name: "系统", secondary: "自动任务" };
  }
}

function presentAuditRecord(
  record: AuditRecord,
  references: ReferenceMaps,
): AuditLogRow {
  const actor = actorView(record);
  const { object, scope } = resolveAuditObject(record, references);
  const actionLabel = auditActionLabel(record.action, record.resourceType);
  const category = auditCategoryFor(record.action);
  const presentation = buildAuditPresentation({
    action: record.action,
    actionLabel,
    resourceType: record.resourceType,
    metadata: record.metadata,
    object,
    scope,
    actorKind: actor.kind as AuditActorKind,
    actorRoleLabel: actor.roleLabel,
    resolveUserName: (id) => references.users.get(id)?.name ?? null,
    resolveRoleGroupName: (id) => references.roleGroups.get(id)?.name ?? null,
  });

  return {
    id: record.id.toString(),
    action: record.action,
    actionLabel,
    category,
    categoryLabel: auditCategoryLabel(category),
    resourceType: record.resourceType,
    resourceLabel: auditResourceLabel(record.resourceType),
    resourceId: record.resourceId,
    result: record.result,
    resultLabel: auditResultLabel(record.result),
    createdAt: record.createdAt.toISOString(),
    actorName: record.actor?.name ?? null,
    actorEmail: record.actor?.email ?? null,
    externalActorName: record.externalActor?.displayName ?? null,
    actorDisplay: legacyActorDisplay(actor),
    actor,
    ipAddress: record.ipAddress,
    ipScope: ipScopeFor(record.ipAddress),
    userAgent: record.userAgent,
    device: describeUserAgent(record.userAgent),
    summary: presentation.summary,
    object,
    scope,
    changes: presentation.changes,
    context: presentation.context,
    metadata: record.metadata,
    projectId: record.projectId,
    customerSpaceId: record.customerSpaceId,
    serviceRequestId: record.serviceRequestId,
  };
}

/** 便于测试与复用：把已取出的记录（含引用）直接转成展示行。 */
export function mapAuditRecords(
  records: AuditRecord[],
  references: ReferenceMaps = EMPTY_REFERENCES,
): AuditLogRow[] {
  return records.map((record) => presentAuditRecord(record, references));
}

/**
 * 「按类目筛选」翻译成精确的 action 列表。
 *
 * 不能用 `startsWith`：Prisma 会把它变成 SQL LIKE，前缀里的 `_` 是单字符
 * 通配符（`NOTIFICATION_PREFERENCE_` 会误命中 `NOTIFICATION_PREFERENCES_...`），
 * 导致筛选结果与展示分类不一致。这里先取库里的动作码，用和展示层同一个
 * `auditCategoryFor` 判定，再用 `IN` 查询，语义完全一致。
 */
export async function auditCategoryWhereForDb(
  tx: Prisma.TransactionClient,
  category: AuditCategoryKey,
): Promise<Prisma.AuditLogWhereInput> {
  const rows = await tx.auditLog.groupBy({ by: ["action"] });
  const actions = rows
    .map((row) => row.action)
    .filter((action) => auditCategoryFor(action) === category);
  return { action: { in: actions } };
}

function buildWhere(
  filters: AuditLogFilters,
  categoryWhere?: Prisma.AuditLogWhereInput,
): Prisma.AuditLogWhereInput {
  const where: Prisma.AuditLogWhereInput = {};
  if (filters.action) where.action = filters.action;
  if (filters.resourceType) where.resourceType = filters.resourceType;
  if (filters.actorId) where.actorId = filters.actorId;
  if (filters.result) {
    // 历史数据里同时存在 FAILURE / FAILED；筛「失败」时两者都要命中
    where.result =
      filters.result === "FAILURE"
        ? { in: ["FAILURE", "FAILED"] }
        : filters.result;
  }

  const and: Prisma.AuditLogWhereInput[] = [];

  if (categoryWhere) {
    and.push(categoryWhere);
  }

  if (filters.from || filters.to) {
    where.createdAt = {
      ...(filters.from ? { gte: filters.from } : {}),
      ...(filters.to ? { lte: filters.to } : {}),
    };
  }

  if (filters.search) {
    const search = filters.search.trim();
    if (search) {
      and.push({
        OR: [
          { resourceId: { contains: search, mode: "insensitive" } },
          { action: { contains: search, mode: "insensitive" } },
          { ipAddress: { contains: search, mode: "insensitive" } },
          { actor: { name: { contains: search, mode: "insensitive" } } },
          { actor: { email: { contains: search, mode: "insensitive" } } },
          { externalActor: { displayName: { contains: search, mode: "insensitive" } } },
          { serviceRequest: { number: { contains: search, mode: "insensitive" } } },
          { serviceRequest: { title: { contains: search, mode: "insensitive" } } },
          { project: { title: { contains: search, mode: "insensitive" } } },
          { customerSpace: { name: { contains: search, mode: "insensitive" } } },
        ],
      });
    }
  }

  if (and.length > 0) where.AND = and;
  return where;
}

/**
 * Audit logs are readable by platform admins only — enforced both here and by
 * the `audit_log_access` RLS policy (`USING (app_is_platform_admin())`).
 */
export async function listAuditLogs(
  actor: Actor,
  filters: AuditLogFilters = {},
): Promise<AuditLogPage> {
  assertAllowed(actor.isPlatformAdmin);

  const pageSize = Math.min(
    Math.max(filters.pageSize ?? 25, 1),
    AUDIT_PAGE_SIZE_MAX,
  );
  const page = Math.max(filters.page ?? 0, 0);

  return withActorDb(actor, async (tx) => {
    const categoryWhere = filters.category
      ? await auditCategoryWhereForDb(tx, filters.category)
      : undefined;
    const where = buildWhere(filters, categoryWhere);
    const total = await tx.auditLog.count({ where });
    const records = await tx.auditLog.findMany({
      where,
      orderBy: { id: "desc" },
      skip: page * pageSize,
      take: pageSize,
      select: auditRecordSelect,
    });
    const references = await loadAuditReferences(tx, records);

    return {
      total,
      page,
      pageSize,
      rows: mapAuditRecords(records, references),
    };
  });
}

export async function getAuditFacets(actor: Actor): Promise<AuditFacets> {
  assertAllowed(actor.isPlatformAdmin);

  return withActorDb(actor, async (tx) => {
    const actions = await tx.auditLog.groupBy({
      by: ["action"],
      orderBy: { action: "asc" },
    });
    const resourceTypes = await tx.auditLog.groupBy({
      by: ["resourceType"],
      orderBy: { resourceType: "asc" },
    });
    const results = await tx.auditLog.groupBy({
      by: ["result"],
      orderBy: { result: "asc" },
    });
    // 不截断人员筛选项：低频用户也必须能被选到，否则执行人筛选会永久漏人
    const actorGroups = await tx.auditLog.groupBy({
      by: ["actorId"],
      where: { actorId: { not: null } },
      _count: { actorId: true },
      orderBy: { _count: { actorId: "desc" } },
    });

    const actorIds = actorGroups
      .map((item) => item.actorId)
      .filter((id): id is string => Boolean(id));
    const users = actorIds.length
      ? await tx.user.findMany({
          where: { id: { in: actorIds } },
          select: { id: true, name: true, email: true, platformRole: true },
        })
      : [];
    const userById = new Map(users.map((item) => [item.id, item]));

    return {
      actions: actions.map((item) => item.action),
      resourceTypes: resourceTypes.map((item) => item.resourceType),
      results: results.map((item) => item.result),
      // 人员筛选项：按操作量倒序，避免把已注销/无记录的用户塞进下拉
      actors: actorIds.flatMap((id) => {
        const user = userById.get(id);
        if (!user) return [];
        return [
          {
            value: id,
            label: user.name,
            secondary: `${PLATFORM_ROLE_LABELS[user.platformRole] ?? user.platformRole} · ${user.email}`,
          },
        ];
      }),
    };
  });
}

/** 供「用户活动」页复用的行映射（引用查询由调用方负责）。 */
export async function presentAuditRecords(
  tx: Prisma.TransactionClient,
  records: AuditRecord[],
): Promise<AuditLogRow[]> {
  const references = await loadAuditReferences(tx, records);
  return mapAuditRecords(records, references);
}

export type { AuditRecord };
