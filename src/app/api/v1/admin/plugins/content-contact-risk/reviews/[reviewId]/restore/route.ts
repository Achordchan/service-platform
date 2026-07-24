import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiActor, routeError } from "@/modules/projects/api-utils";
import { restoreContentRiskReview } from "@/modules/plugins/content-risk-review-service";

const schema = z.object({ reason: z.string().trim().min(2).max(500) });

export async function POST(
  request: Request,
  context: { params: Promise<{ reviewId: string }> },
) {
  const auth = await requireApiActor();
  if (auth.response) return auth.response;
  try {
    const { reviewId } = await context.params;
    const { reason } = schema.parse(await request.json());
    return NextResponse.json({
      data: await restoreContentRiskReview(auth.actor, reviewId, reason),
    });
  } catch (error) {
    return routeError(error);
  }
}
