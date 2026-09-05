import { NextResponse } from "next/server";
import { requireApiActor, routeError } from "@/modules/projects/api-utils";
import { listFeedback } from "@/modules/feedback/feedback-service";
import { listFeedbackQuerySchema } from "@/modules/feedback/schemas";

export const dynamic = "force-dynamic";

// 员工端反馈列表：服务层校验 isStaff（RLS feedback_select 双重把关）。
export async function GET(request: Request) {
  const auth = await requireApiActor();
  if (auth.response) return auth.response;

  try {
    const url = new URL(request.url);
    const filters = listFeedbackQuerySchema.parse(
      Object.fromEntries(
        [...url.searchParams.entries()].filter(([, value]) => value !== ""),
      ),
    );

    const page = await listFeedback(auth.actor, filters);
    return NextResponse.json({ data: page });
  } catch (error) {
    return routeError(error, { operation: "feedback.list" });
  }
}
