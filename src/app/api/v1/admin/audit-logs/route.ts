import { NextResponse } from "next/server";
import { z } from "zod";
import {
  AUDIT_PAGE_SIZE_MAX,
  getAuditFacets,
  listAuditLogs,
} from "@/modules/audit/audit-query";
import { buildAuditFacetOptions } from "@/modules/audit/audit-facet-options";
import { auditCategoryOptions } from "@/modules/audit/audit-presentation";
import type { AuditCategoryKey } from "@/modules/audit/audit-types";
import { dateBound } from "@/modules/http/date-bound";
import { requireApiActor, routeError } from "@/modules/projects/api-utils";

const optionalText = z
  .string()
  .trim()
  .max(200)
  .optional()
  .transform((value) => (value ? value : undefined));

const categoryValues = auditCategoryOptions.map((option) => option.value) as [
  AuditCategoryKey,
  ...AuditCategoryKey[],
];

const querySchema = z.object({
  action: optionalText,
  resourceType: optionalText,
  actorId: optionalText,
  result: optionalText,
  category: z.enum(categoryValues).optional(),
  search: optionalText,
  from: dateBound("start"),
  to: dateBound("end"),
  page: z.coerce.number().int().min(0).default(0),
  pageSize: z.coerce.number().int().min(1).max(AUDIT_PAGE_SIZE_MAX).default(25),
});

export async function GET(request: Request) {
  const auth = await requireApiActor();
  if (auth.response) return auth.response;

  try {
    const url = new URL(request.url);
    const filters = querySchema.parse(
      Object.fromEntries(
        [...url.searchParams.entries()].filter(([, value]) => value !== ""),
      ),
    );

    const [page, facets] = await Promise.all([
      listAuditLogs(auth.actor, filters),
      url.searchParams.get("withFacets") === "1"
        ? getAuditFacets(auth.actor)
        : Promise.resolve(undefined),
    ]);

    // 带中文标签的筛选项（小程序据此渲染，不再复制那套动作码字典）。必须与原有的
    // actions/resourceTypes/results 三个字符串数组并存：部署瞬间浏览器里还挂着旧
    // 的 Web bundle，它把每一项当字符串用，改形状会让那些页面的筛选直接渲染坏。
    const labelledFacets = facets ? buildAuditFacetOptions(facets) : undefined;

    // `apiRequest` unwraps `data`, so facets must travel inside it.
    return NextResponse.json({
      data: { ...page, facets: labelledFacets },
    });
  } catch (error) {
    return routeError(error, { operation: "audit_logs.list" });
  }
}
