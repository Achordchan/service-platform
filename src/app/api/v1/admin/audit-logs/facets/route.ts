import { NextResponse } from "next/server";
import { getAuditFacets } from "@/modules/audit/audit-query";
import { buildAuditFacetOptions } from "@/modules/audit/audit-facet-options";
import { requireApiActor, routeError } from "@/modules/projects/api-utils";

export async function GET() {
  const auth = await requireApiActor();
  if (auth.response) return auth.response;

  try {
    const facets = await getAuditFacets(auth.actor);
    return NextResponse.json({ data: buildAuditFacetOptions(facets) });
  } catch (error) {
    return routeError(error, { operation: "audit_logs.facets" });
  }
}
