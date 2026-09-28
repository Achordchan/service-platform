import { NextResponse } from "next/server";
import { universalContactUnreadParamsSchema } from "@/modules/integrations/universal/schemas";
import { authenticateUniversalLaunchRequest } from "@/modules/integrations/universal/ticket-service";
import { getUniversalContactUnread } from "@/modules/integrations/universal/unread-service";
import { routeError } from "@/modules/projects/api-utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ externalUserId: string }> };

export async function GET(request: Request, context: RouteContext) {
  try {
    const authentication = await authenticateUniversalLaunchRequest(request);
    const { externalUserId } = universalContactUnreadParamsSchema.parse(
      await context.params,
    );
    return NextResponse.json(
      { data: await getUniversalContactUnread(authentication, externalUserId) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return routeError(error);
  }
}
