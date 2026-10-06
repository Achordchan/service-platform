import { withActorDb } from "@/lib/actor";
import { assertAllowed } from "@/modules/projects/errors";
import { requireApiActor, routeError } from "@/modules/projects/api-utils";
import { writeAuditLog } from "@/modules/audit/audit-service";
import {
  searchParamsToObject,
  systemErrorFilterSchema,
} from "@/modules/system-errors/system-error-filters";
import {
  toExportCsv,
  toExportJson,
} from "@/modules/system-errors/system-error-export";
import {
  exportSystemErrors,
  SYSTEM_ERROR_EXPORT_MAX_ROWS,
} from "@/modules/system-errors/system-error-query";
import { z } from "zod";

const formatSchema = z.enum(["json", "csv"]).default("json");

function timestampForFileName(date: Date) {
  return date.toISOString().replaceAll(/[-:]/g, "").slice(0, 15);
}

export async function GET(request: Request) {
  const auth = await requireApiActor();
  if (auth.response) return auth.response;

  try {
    assertAllowed(auth.actor.isPlatformAdmin);
    const url = new URL(request.url);
    const params = searchParamsToObject(url.searchParams);
    const format = formatSchema.parse(params.format);
    const filters = systemErrorFilterSchema.parse(params);

    const result = await exportSystemErrors(auth.actor, filters);
    // 导出等于把线上报错交给第三方，留痕：谁、按什么条件、导了多少条
    await withActorDb(auth.actor, (tx) =>
      writeAuditLog(tx, auth.actor, {
        action: "SYSTEM_ERROR_LOG_EXPORTED",
        resourceType: "SystemErrorLog",
        metadata: {
          format,
          rowCount: result.rows.length,
          total: result.total,
          truncated: result.truncated,
          filters: Object.fromEntries(
            Object.entries(params).filter(([key]) => key !== "format"),
          ),
        },
      }),
    );

    const fileName = `system-errors-${timestampForFileName(new Date())}.${format}`;
    const headers = {
      "Cache-Control": "no-store",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "X-Export-Total": String(result.total),
      "X-Export-Truncated": String(result.truncated),
      "X-Export-Max-Rows": String(SYSTEM_ERROR_EXPORT_MAX_ROWS),
    };
    if (format === "csv") {
      return new Response(toExportCsv(result.rows), {
        headers: { ...headers, "Content-Type": "text/csv; charset=utf-8" },
      });
    }
    return new Response(
      JSON.stringify(
        {
          exportedAt: new Date().toISOString(),
          total: result.total,
          truncated: result.truncated,
          rows: toExportJson(result.rows),
        },
        null,
        2,
      ),
      { headers: { ...headers, "Content-Type": "application/json; charset=utf-8" } },
    );
  } catch (error) {
    return routeError(error, { operation: "system_errors.export", request });
  }
}
