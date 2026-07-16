import { NextResponse } from "next/server";
import { z } from "zod";
import { deletionResourceTypes } from "@/modules/deletion/deletion-types";
import { getDeletionPreflight } from "@/modules/deletion/deletion-service";
import {
  readJson,
  requireApiActor,
  routeError,
} from "@/modules/projects/api-utils";

const schema = z.object({
  resourceType: z.enum(deletionResourceTypes),
  resourceId: z.string().min(1),
});

export async function POST(request: Request) {
  const auth = await requireApiActor();
  if (auth.response) return auth.response;

  try {
    const input = schema.parse(await readJson(request));
    const report = await getDeletionPreflight(
      auth.actor,
      input.resourceType,
      input.resourceId,
    );
    return NextResponse.json({ data: report });
  } catch (error) {
    return routeError(error);
  }
}
