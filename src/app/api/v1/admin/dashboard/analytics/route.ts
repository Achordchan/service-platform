import { NextResponse } from "next/server";
import { getDashboardAnalytics } from "@/modules/dashboard/dashboard-analytics-service";
import { requireApiActor, routeError } from "@/modules/projects/api-utils";

export async function GET() {
  const auth = await requireApiActor();
  if (auth.response) return auth.response;

  try {
    return NextResponse.json({
      data: await getDashboardAnalytics(auth.actor),
    });
  } catch (error) {
    return routeError(error, { operation: "dashboard.analytics" });
  }
}
