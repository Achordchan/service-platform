import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuditPersonDetail } from "@/modules/audit/audit-activity";
import { auditRangeSchema, resolveAuditRange } from "@/modules/audit/audit-range";
import { AUDIT_PAGE_SIZE_MAX } from "@/modules/audit/audit-query";
import { auditCategoryOptions } from "@/modules/audit/audit-presentation";
import type { AuditCategoryKey } from "@/modules/audit/audit-types";
import { DomainError } from "@/modules/projects/errors";
import { requireApiActor, routeError } from "@/modules/projects/api-utils";

type RouteContext = { params: Promise<{ userId: string }> };

const categoryValues = auditCategoryOptions.map((option) => option.value) as [
  AuditCategoryKey,
  ...AuditCategoryKey[],
];

const querySchema = auditRangeSchema.extend({
  category: z.enum(categoryValues).optional(),
  page: z.coerce.number().int().min(0).default(0),
  pageSize: z.coerce.number().int().min(1).max(AUDIT_PAGE_SIZE_MAX).default(25),
});

export async function GET(request: Request, context: RouteContext) {
  const auth = await requireApiActor();
  if (auth.response) return auth.response;

  try {
    const { userId } = await context.params;
    const url = new URL(request.url);
    const params = querySchema.parse({
      from: url.searchParams.get("from") ?? undefined,
      to: url.searchParams.get("to") ?? undefined,
      category: url.searchParams.get("category") ?? undefined,
      page: url.searchParams.get("page") ?? undefined,
      pageSize: url.searchParams.get("pageSize") ?? undefined,
    });
    const range = resolveAuditRange({ from: params.from, to: params.to });
    const detail = await getAuditPersonDetail(
      auth.actor,
      decodeURIComponent(userId),
      {
        ...range,
        page: params.page,
        pageSize: params.pageSize,
        category: params.category,
      },
    );
    if (!detail) {
      throw new DomainError("AUDIT_PERSON_NOT_FOUND", "没有找到这个用户", 404);
    }
    return NextResponse.json({ data: detail });
  } catch (error) {
    return routeError(error, { operation: "audit_logs.person" });
  }
}
