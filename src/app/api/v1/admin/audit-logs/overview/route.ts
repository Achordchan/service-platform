import { NextResponse } from "next/server";
import { getAuditOverview } from "@/modules/audit/audit-activity";
import {
  auditRangeSchema,
  resolveAuditRange,
} from "@/modules/audit/audit-range";
import { requireApiActor, routeError } from "@/modules/projects/api-utils";

export async function GET(request: Request) {
  const auth = await requireApiActor();
  if (auth.response) return auth.response;

  try {
    const url = new URL(request.url);
    const range = resolveAuditRange(
      auditRangeSchema.parse({
        from: url.searchParams.get("from") ?? undefined,
        to: url.searchParams.get("to") ?? undefined,
      }),
    );
    const overview = await getAuditOverview(auth.actor, range);
    return NextResponse.json({ data: overview });
  } catch (error) {
    return routeError(error, { operation: "audit_logs.overview" });
  }
}
