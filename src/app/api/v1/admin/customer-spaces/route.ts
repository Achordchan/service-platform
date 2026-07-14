import { NextResponse } from "next/server";
import {
  createCustomerSpace,
  listCustomerSpaces,
} from "@/modules/customer-spaces/customer-space-service";
import { createCustomerSpaceSchema } from "@/modules/customer-spaces/schemas";
import {
  readJson,
  requireApiActor,
  routeError,
} from "@/modules/projects/api-utils";

export async function GET() {
  const auth = await requireApiActor();
  if (auth.response) return auth.response;

  try {
    const spaces = await listCustomerSpaces(auth.actor);
    return NextResponse.json({ data: spaces });
  } catch (error) {
    return routeError(error);
  }
}

export async function POST(request: Request) {
  const auth = await requireApiActor();
  if (auth.response) return auth.response;

  try {
    const input = createCustomerSpaceSchema.parse(await readJson(request));
    const space = await createCustomerSpace(auth.actor, input);
    return NextResponse.json({ data: space }, { status: 201 });
  } catch (error) {
    return routeError(error);
  }
}
