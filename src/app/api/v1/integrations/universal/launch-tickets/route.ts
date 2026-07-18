import { NextResponse } from "next/server";
import { universalLaunchTicketSchema } from "@/modules/integrations/universal/schemas";
import {
  authenticateUniversalLaunchRequest,
  issueUniversalLaunchTicket,
} from "@/modules/integrations/universal/ticket-service";
import { readJson, routeError } from "@/modules/projects/api-utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const authentication = await authenticateUniversalLaunchRequest(request);
    const input = universalLaunchTicketSchema.parse(
      await readJson(request, { maxBytes: 64 * 1024 }),
    );
    return NextResponse.json(
      { data: await issueUniversalLaunchTicket(authentication, input) },
      {
        status: 201,
        headers: { "Cache-Control": "no-store" },
      },
    );
  } catch (error) {
    return routeError(error);
  }
}
