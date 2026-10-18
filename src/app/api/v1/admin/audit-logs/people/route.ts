import { NextResponse } from "next/server";
import { z } from "zod";
import { listAuditPeople } from "@/modules/audit/audit-activity";
import { auditRangeSchema, resolveAuditRange } from "@/modules/audit/audit-range";
import { AUDIT_PAGE_SIZE_MAX } from "@/modules/audit/audit-query";
import { requireApiActor, routeError } from "@/modules/projects/api-utils";

const optionalText = z
  .string()
  .trim()
  .max(120)
  .optional()
  .transform((value) => (value ? value : undefined));

const querySchema = auditRangeSchema.extend({
  search: optionalText,
  role: z.enum(["STAFF", "CUSTOMER"]).optional(),
  page: z.coerce.number().int().min(0).default(0),
  pageSize: z.coerce
    .number()
    .int()
    .min(1)
    .max(AUDIT_PAGE_SIZE_MAX)
    .default(25),
});

export async function GET(request: Request) {
  const auth = await requireApiActor();
  if (auth.response) return auth.response;

  try {
    const url = new URL(request.url);
    const params = querySchema.parse({
      from: url.searchParams.get("from") ?? undefined,
      to: url.searchParams.get("to") ?? undefined,
      search: url.searchParams.get("search") ?? undefined,
      role: url.searchParams.get("role") ?? undefined,
      page: url.searchParams.get("page") ?? undefined,
      pageSize: url.searchParams.get("pageSize") ?? undefined,
    });
    const range = resolveAuditRange({ from: params.from, to: params.to });
    const page = await listAuditPeople(auth.actor, {
      ...range,
      search: params.search,
      role: params.role,
      page: params.page,
      pageSize: params.pageSize,
    });
    return NextResponse.json({ data: page });
  } catch (error) {
    return routeError(error, { operation: "audit_logs.people" });
  }
}
