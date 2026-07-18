import { NextResponse } from "next/server";
import { universalExchangeSchema } from "@/modules/integrations/universal/schemas";
import { exchangeUniversalTicket } from "@/modules/integrations/universal/ticket-service";
import { readJson, routeError } from "@/modules/projects/api-utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const input = universalExchangeSchema.parse(
      await readJson(request, { maxBytes: 64 * 1024 }),
    );
    return NextResponse.json(
      { data: await exchangeUniversalTicket(request, input) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return routeError(error);
  }
}
