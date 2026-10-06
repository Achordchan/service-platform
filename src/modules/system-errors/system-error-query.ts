import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import type { Actor } from "@/lib/actor";
import { withActorDb } from "@/lib/actor";
import { assertAllowed } from "@/modules/projects/errors";
import { summarizeSystemError } from "@/modules/system-errors/system-error-labels";

import {
  SYSTEM_ERROR_EXPORT_MAX_ROWS,
  SYSTEM_ERROR_PAGE_SIZE_MAX,
} from "@/modules/system-errors/system-error-limits";

export { SYSTEM_ERROR_EXPORT_MAX_ROWS, SYSTEM_ERROR_PAGE_SIZE_MAX };
const RELATED_WINDOW_MS = 24 * 60 * 60 * 1000;
const RELATED_LIMIT = 10;

export type SystemErrorFilters = {
  /** 错误编号精确匹配（用户报错时会带编号） */
  referenceId?: string;
  category?: string;
  source?: string;
  operation?: string;
  actorType?: string;
  from?: Date;
  to?: Date;
  /** 自由搜索：含错误编号就按编号精确匹配，否则模糊匹配来源 / 操作 / 路径 */
  search?: string;
  page?: number;
  pageSize?: number;
};

export type SystemErrorRow = {
  id: string;
  referenceId: string;
  category: string;
  errorName: string;
  source: string;
  operation: string | null;
  requestMethod: string | null;
  requestPath: string | null;
  actorType: string | null;
  actorId: string | null;
  actorName: string | null;
  occurrenceCount: number;
  summary: string;
  createdAt: string;
};

export type SystemErrorDetail = SystemErrorRow & {
  details: Prisma.JsonValue;
  context: Prisma.JsonValue | null;
  related: SystemErrorRow[];
  relatedWindowHours: number;
};

export type SystemErrorPage = {
  rows: SystemErrorRow[];
  total: number;
  page: number;
  pageSize: number;
};

export type SystemErrorFacets = {
  categories: string[];
  sources: string[];
  operations: string[];
};

// 用户报错时带的编号：err_ 加 32 位十六进制，或邮件失败的 mail_<邮件ID>
const REFERENCE_TOKEN = /\b(err_[a-f0-9]{32}|mail_[A-Za-z0-9_-]{1,120})\b/i;

export function extractReferenceId(text: string) {
  const match = REFERENCE_TOKEN.exec(text);
  if (!match) return undefined;
  // err_ 编号是小写十六进制；用户从邮件/聊天里复制可能被改成大写
  return match[1].toLowerCase().startsWith("err_")
    ? match[1].toLowerCase()
    : match[1];
}

export function buildSystemErrorWhere(
  filters: SystemErrorFilters,
): Prisma.SystemErrorLogWhereInput {
  const where: Prisma.SystemErrorLogWhereInput = {};
  const and: Prisma.SystemErrorLogWhereInput[] = [];
  if (filters.referenceId) {
    where.referenceId = extractReferenceId(filters.referenceId) ?? filters.referenceId.trim();
  }
  if (filters.category) where.category = filters.category;
  if (filters.source) where.source = filters.source;
  if (filters.operation) where.operation = filters.operation;
  if (filters.actorType) where.actorType = filters.actorType;
  if (filters.from || filters.to) {
    where.createdAt = {
      ...(filters.from ? { gte: filters.from } : {}),
      ...(filters.to ? { lte: filters.to } : {}),
    };
  }
  const search = filters.search?.trim();
  if (search) {
    const reference = extractReferenceId(search);
    if (reference) {
      and.push({ referenceId: reference });
    } else {
      and.push({
        OR: [
          { source: { contains: search, mode: "insensitive" } },
          { operation: { contains: search, mode: "insensitive" } },
          { requestPath: { contains: search, mode: "insensitive" } },
          { errorName: { contains: search, mode: "insensitive" } },
        ],
      });
    }
  }
  if (and.length) where.AND = and;
  return where;
}

const listSelect = {
  id: true,
  referenceId: true,
  category: true,
  errorName: true,
  source: true,
  operation: true,
  requestMethod: true,
  requestPath: true,
  actorType: true,
  actorId: true,
  occurrenceCount: true,
  createdAt: true,
  details: true,
} satisfies Prisma.SystemErrorLogSelect;

type ListRecord = Prisma.SystemErrorLogGetPayload<{ select: typeof listSelect }>;

async function actorNames(tx: Prisma.TransactionClient, records: ListRecord[]) {
  const userIds = new Set<string>();
  const externalIds = new Set<string>();
  for (const record of records) {
    if (!record.actorId) continue;
    if (record.actorType === "STAFF" || record.actorType === "CUSTOMER") {
      userIds.add(record.actorId);
    } else if (record.actorType === "EXTERNAL_CONTACT") {
      externalIds.add(record.actorId);
    }
  }
  const [users, contacts] = await Promise.all([
    userIds.size
      ? tx.user.findMany({
          where: { id: { in: [...userIds] } },
          select: { id: true, name: true },
        })
      : [],
    externalIds.size
      ? tx.externalContact.findMany({
          where: { id: { in: [...externalIds] } },
          select: { id: true, displayName: true },
        })
      : [],
  ]);
  const names = new Map<string, string>();
  for (const user of users) names.set(user.id, user.name);
  for (const contact of contacts) names.set(contact.id, contact.displayName);
  return names;
}

function toRow(record: ListRecord, names: Map<string, string>): SystemErrorRow {
  return {
    // id 是 BigInt 列，JSON 序列化不了
    id: record.id.toString(),
    referenceId: record.referenceId,
    category: record.category,
    errorName: record.errorName,
    source: record.source,
    operation: record.operation,
    requestMethod: record.requestMethod,
    requestPath: record.requestPath,
    actorType: record.actorType,
    actorId: record.actorId,
    actorName: record.actorId ? (names.get(record.actorId) ?? null) : null,
    occurrenceCount: record.occurrenceCount,
    summary: summarizeSystemError(record.details, record.category),
    createdAt: record.createdAt.toISOString(),
  };
}

/** 系统报错只对平台管理员可见：服务层断言 + system_error_log_* RLS 策略双重保证 */
export async function listSystemErrors(
  actor: Actor,
  filters: SystemErrorFilters = {},
): Promise<SystemErrorPage> {
  assertAllowed(actor.isPlatformAdmin);

  const pageSize = Math.min(
    Math.max(filters.pageSize ?? 25, 1),
    SYSTEM_ERROR_PAGE_SIZE_MAX,
  );
  const page = Math.max(filters.page ?? 0, 0);
  const where = buildSystemErrorWhere(filters);

  return withActorDb(actor, async (tx) => {
    const total = await tx.systemErrorLog.count({ where });
    const records = await tx.systemErrorLog.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: page * pageSize,
      take: pageSize,
      select: listSelect,
    });
    const names = await actorNames(tx, records);
    return {
      total,
      page,
      pageSize,
      rows: records.map((record) => toRow(record, names)),
    };
  });
}

export async function getSystemErrorFacets(actor: Actor): Promise<SystemErrorFacets> {
  assertAllowed(actor.isPlatformAdmin);

  return withActorDb(actor, async (tx) => {
    const [categories, sources, operations] = await Promise.all([
      tx.systemErrorLog.groupBy({ by: ["category"], orderBy: { category: "asc" } }),
      tx.systemErrorLog.groupBy({ by: ["source"], orderBy: { source: "asc" } }),
      tx.systemErrorLog.groupBy({ by: ["operation"], orderBy: { operation: "asc" } }),
    ]);
    return {
      categories: categories.map((item) => item.category),
      sources: sources.map((item) => item.source),
      operations: operations
        .map((item) => item.operation)
        .filter((value): value is string => Boolean(value)),
    };
  });
}

/** 按错误编号取详情，附「同一操作最近 24 小时的同类错误」 */
export async function getSystemErrorDetail(
  actor: Actor,
  referenceId: string,
): Promise<SystemErrorDetail | null> {
  assertAllowed(actor.isPlatformAdmin);

  return withActorDb(actor, async (tx) => {
    const record = await tx.systemErrorLog.findUnique({
      where: { referenceId },
      select: { ...listSelect, context: true },
    });
    if (!record) return null;
    const since = new Date(record.createdAt.getTime() - RELATED_WINDOW_MS);
    const related = await tx.systemErrorLog.findMany({
      where: {
        id: { not: record.id },
        category: record.category,
        // 有 operation 按 operation；没有就退到同一来源，避免把无关错误混进来
        ...(record.operation
          ? { operation: record.operation }
          : { source: record.source, operation: null }),
        createdAt: { gte: since, lte: record.createdAt },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: RELATED_LIMIT,
      select: listSelect,
    });
    const names = await actorNames(tx, [record, ...related]);
    return {
      ...toRow(record, names),
      details: record.details,
      context: record.context,
      related: related.map((item) => toRow(item, names)),
      relatedWindowHours: RELATED_WINDOW_MS / 3_600_000,
    };
  });
}

export type SystemErrorExportRow = SystemErrorRow & {
  details: Prisma.JsonValue;
  context: Prisma.JsonValue | null;
};

/** 导出按筛选结果，最多 SYSTEM_ERROR_EXPORT_MAX_ROWS 条；truncated 表示还有更多 */
export async function exportSystemErrors(
  actor: Actor,
  filters: SystemErrorFilters = {},
): Promise<{ rows: SystemErrorExportRow[]; total: number; truncated: boolean }> {
  assertAllowed(actor.isPlatformAdmin);
  const where = buildSystemErrorWhere(filters);

  return withActorDb(actor, async (tx) => {
    const total = await tx.systemErrorLog.count({ where });
    const records = await tx.systemErrorLog.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: SYSTEM_ERROR_EXPORT_MAX_ROWS,
      select: { ...listSelect, context: true },
    });
    const names = await actorNames(tx, records);
    return {
      total,
      truncated: total > records.length,
      rows: records.map((record) => ({
        ...toRow(record, names),
        details: record.details,
        context: record.context,
      })),
    };
  });
}
