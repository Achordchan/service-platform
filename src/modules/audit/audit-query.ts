import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import type { Actor } from "@/lib/actor";
import { withActorDb } from "@/lib/actor";
import { assertAllowed } from "@/modules/projects/errors";

export const AUDIT_PAGE_SIZE_MAX = 100;

export type AuditLogFilters = {
  action?: string;
  resourceType?: string;
  actorId?: string;
  result?: string;
  from?: Date;
  to?: Date;
  search?: string;
  page?: number;
  pageSize?: number;
};

export type AuditLogRow = {
  id: string;
  action: string;
  resourceType: string;
  resourceId: string | null;
  result: string;
  createdAt: string;
  actorName: string | null;
  actorEmail: string | null;
  externalActorName: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  metadata: Prisma.JsonValue | null;
  projectId: string | null;
  customerSpaceId: string | null;
  serviceRequestId: string | null;
};

export type AuditLogPage = {
  rows: AuditLogRow[];
  total: number;
  page: number;
  pageSize: number;
};

export type AuditFacets = {
  actions: string[];
  resourceTypes: string[];
  results: string[];
};

function buildWhere(filters: AuditLogFilters): Prisma.AuditLogWhereInput {
  const where: Prisma.AuditLogWhereInput = {};
  if (filters.action) where.action = filters.action;
  if (filters.resourceType) where.resourceType = filters.resourceType;
  if (filters.actorId) where.actorId = filters.actorId;
  if (filters.result) where.result = filters.result;
  if (filters.from || filters.to) {
    where.createdAt = {
      ...(filters.from ? { gte: filters.from } : {}),
      ...(filters.to ? { lte: filters.to } : {}),
    };
  }
  if (filters.search) {
    const search = filters.search.trim();
    if (search) {
      where.OR = [
        { resourceId: { contains: search, mode: "insensitive" } },
        { action: { contains: search, mode: "insensitive" } },
        { ipAddress: { contains: search, mode: "insensitive" } },
        { actor: { name: { contains: search, mode: "insensitive" } } },
        { actor: { email: { contains: search, mode: "insensitive" } } },
      ];
    }
  }
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
  const where = buildWhere(filters);

  return withActorDb(actor, async (tx) => {
    const total = await tx.auditLog.count({ where });
    const records = await tx.auditLog.findMany({
      where,
      orderBy: { id: "desc" },
      skip: page * pageSize,
      take: pageSize,
      select: {
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
        actor: { select: { name: true, email: true } },
        externalActor: { select: { displayName: true } },
      },
    });

    return {
      total,
      page,
      pageSize,
      rows: records.map((record) => ({
        // `id` is a BigInt column and does not survive JSON serialisation.
        id: record.id.toString(),
        action: record.action,
        resourceType: record.resourceType,
        resourceId: record.resourceId,
        result: record.result,
        createdAt: record.createdAt.toISOString(),
        actorName: record.actor?.name ?? null,
        actorEmail: record.actor?.email ?? null,
        externalActorName: record.externalActor?.displayName ?? null,
        ipAddress: record.ipAddress,
        userAgent: record.userAgent,
        metadata: record.metadata,
        projectId: record.projectId,
        customerSpaceId: record.customerSpaceId,
        serviceRequestId: record.serviceRequestId,
      })),
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
    return {
      actions: actions.map((item) => item.action),
      resourceTypes: resourceTypes.map((item) => item.resourceType),
      results: results.map((item) => item.result),
    };
  });
}
