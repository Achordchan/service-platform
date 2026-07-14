import { NextResponse } from "next/server";
import { z } from "zod";
import {
  requireApiActor,
  routeError,
} from "@/modules/projects/api-utils";
import { listUsers } from "@/modules/users/user-service";

const querySchema = z.object({
  role: z
    .enum([
      "CUSTOMER",
      "PROJECT_MANAGER",
      "TECHNICIAN",
      "PLATFORM_ADMIN",
    ])
    .optional(),
  query: z.string().trim().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

export async function GET(request: Request) {
  const auth = await requireApiActor();
  if (auth.response) return auth.response;

  try {
    const url = new URL(request.url);
    const input = querySchema.parse({
      role: url.searchParams.get("role") || undefined,
      query: url.searchParams.get("query") || undefined,
      limit: url.searchParams.get("limit") || undefined,
    });
    const users = await listUsers(auth.actor, input);
    return NextResponse.json({ data: users });
  } catch (error) {
    return routeError(error);
  }
}
