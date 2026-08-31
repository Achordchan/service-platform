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
import { requireApiActor, routeError } from "@/modules/projects/api-utils";

const optionalText = z
  .string()
  .trim()
  .max(200)
  .optional()
  .transform((value) => (value ? value : undefined));

// 日期边界：管理端日期选择器传 YYYY-MM-DD，目标用户在中国（Asia/Shanghai）。
// 按 +08:00 日界换算为 UTC 瞬时（否则 UTC 日界会把当天头 8 小时漏掉、混入次日数据）；
// 完整时间戳原样透传。结束日期取当天 23:59:59.999 配合 lte 全含当天。
// 真实日历校验：JS Date 会把 2026-02-31 静默归一化到 3 月，必须显式拒绝
function isValidCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const probe = new Date(Date.UTC(year, month - 1, day));
  return (
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day
  );
}

function dateBound(kind: "start" | "end") {
  return z
    .string()
    .trim()
    .min(1)
    .optional()
    .transform((value, ctx) => {
      if (!value) return undefined;
      if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        if (!isValidCalendarDate(value)) {
          ctx.addIssue({ code: "custom", message: "日期不存在" });
          return z.NEVER;
        }
        return kind === "start"
          ? new Date(`${value}T00:00:00+08:00`)
          : new Date(`${value}T23:59:59.999+08:00`);
      }
      const parsed = new Date(value);
      if (Number.isNaN(parsed.getTime())) {
        ctx.addIssue({ code: "custom", message: "日期格式无效" });
        return z.NEVER;
      }
      return parsed;
    });
}

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

    // 筛选项同样带上中文标签，两端共用同一份映射（小程序不再复制动作码字典）。
    const labelledFacets = facets
      ? {
          actions: facets.actions.map((value) => ({
            value,
            label: auditActionLabel(value),
          })),
          resourceTypes: facets.resourceTypes.map((value) => ({
            value,
            label: auditResourceLabel(value),
          })),
          results: facets.results.map((value) => ({
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
