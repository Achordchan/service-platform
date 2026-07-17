import { NextResponse } from "next/server";
import { sub2ApiExchangeSchema } from "@/modules/integrations/sub2api/schemas";
import { exchangeSub2ApiIdentity } from "@/modules/integrations/sub2api/session-service";
import { readJson, routeError } from "@/modules/projects/api-utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const input = sub2ApiExchangeSchema.parse(await readJson(request));
    return NextResponse.json({
      data: await exchangeSub2ApiIdentity(request, input),
    });
  } catch (error) {
    return routeError(error);
  }
}
