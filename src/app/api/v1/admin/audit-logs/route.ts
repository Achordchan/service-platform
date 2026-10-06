import { NextResponse } from "next/server";
import { z } from "zod";
import {
  AUDIT_PAGE_SIZE_MAX,
  getAuditFacets,
  listAuditLogs,
} from "@/modules/audit/audit-query";
import {
  auditActionLabel,
  auditResourceLabel,
  auditResultLabel,
  isUnauthenticatedAuditAction,
} from "@/modules/audit/audit-labels";
import { dateBound } from "@/modules/http/date-bound";
import { requireApiActor, routeError } from "@/modules/projects/api-utils";

const optionalText = z
  .string()
  .trim()
  .max(200)
  .optional()
  .transform((value) => (value ? value : undefined));

const querySchema = z.object({
  action: optionalText,
  resourceType: optionalText,
  actorId: optionalText,
  result: optionalText,
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

    // 附加 server 端已有的中文标签与操作者展示（附加字段，Web 端忽略即可）：
    // 小程序简版审计据此直接渲染，无需在小程序复制这套 ~90 条动作码映射。
    const rows = page.rows.map((row) => ({
      ...row,
      actionLabel: auditActionLabel(row.action, row.resourceType),
      resourceLabel: auditResourceLabel(row.resourceType),
      resultLabel: auditResultLabel(row.result),
      actorDisplay: row.actorName
        ? { name: row.actorName, secondary: row.actorEmail ?? "—" }
        : row.externalActorName
          ? { name: row.externalActorName, secondary: "外部联系人" }
          : isUnauthenticatedAuditAction(row.action)
            ? { name: "未认证访客", secondary: "未登录尝试" }
            : { name: "系统", secondary: "自动任务" },
    }));

    // 带中文标签的筛选项（小程序据此渲染，不再复制那套动作码字典）。必须与原有的
    // actions/resourceTypes/results 三个字符串数组并存：部署瞬间浏览器里还挂着旧
    // 的 Web bundle，它把每一项当字符串用，改形状会让那些页面的筛选直接渲染坏。
    const labelledFacets = facets
      ? {
          ...facets,
          actionOptions: facets.actions.map((value) => ({
            value,
            label: auditActionLabel(value),
          })),
          resourceTypeOptions: facets.resourceTypes.map((value) => ({
            value,
            label: auditResourceLabel(value),
          })),
          resultOptions: facets.results.map((value) => ({
            value,
            label: auditResultLabel(value),
          })),
        }
      : undefined;

    // `apiRequest` unwraps `data`, so facets must travel inside it.
    return NextResponse.json({
      data: { ...page, rows, facets: labelledFacets },
    });
  } catch (error) {
    return routeError(error, { operation: "audit_logs.list" });
  }
}
