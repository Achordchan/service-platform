import { NextResponse } from "next/server";
import { requireApiActor, routeError } from "@/modules/projects/api-utils";
import { getContentRiskAdminDashboard } from "@/modules/plugins/content-risk-admin-service";

export async function GET() {
  const auth = await requireApiActor();
  if (auth.response) return auth.response;
  try {
    return NextResponse.json({
      data: await getContentRiskAdminDashboard(auth.actor),
    });
  } catch (error) {
    return routeError(error);
  }
}
