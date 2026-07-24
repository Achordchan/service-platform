import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiActor, routeError } from "@/modules/projects/api-utils";
import { discoverConfiguredContentRiskModels } from "@/modules/plugins/content-risk-admin-service";

const schema = z.object({
  baseUrl: z.string().trim().max(2048).optional(),
  apiKey: z.string().trim().max(4096).optional(),
});

export async function POST(request: Request) {
  const auth = await requireApiActor();
  if (auth.response) return auth.response;
  try {
    const input = schema.parse(await request.json());
    const models = await discoverConfiguredContentRiskModels(auth.actor, input);
    return NextResponse.json({ data: { models } });
  } catch (error) {
    return routeError(error, {
      operation: "content_risk.models.discover",
      request,
    });
  }
}
