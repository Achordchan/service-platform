import { NextResponse } from "next/server";
import { z } from "zod";
import {
  cancelUserEmailChange,
  getPendingUserEmailChange,
  requestUserEmailChange,
} from "@/modules/users/customer-email-change-service";
import {
  readJson,
  requireApiActor,
  routeError,
} from "@/modules/projects/api-utils";

const schema = z.object({
  newEmail: z.string().trim().email().max(160),
});

export async function GET() {
  const auth = await requireApiActor();
  if (auth.response) return auth.response;
  try {
    return NextResponse.json({
      data: await getPendingUserEmailChange(auth.actor, auth.actor.id),
    });
  } catch (error) {
    return routeError(error);
  }
}

export async function POST(request: Request) {
  const auth = await requireApiActor();
  if (auth.response) return auth.response;
  try {
    const input = schema.parse(await readJson(request));
    const result = await requestUserEmailChange(
      auth.actor,
      auth.actor.id,
      input.newEmail,
    );
    return NextResponse.json({ data: result }, { status: 201 });
  } catch (error) {
    return routeError(error);
  }
}

export async function DELETE() {
  const auth = await requireApiActor();
  if (auth.response) return auth.response;
  try {
    await cancelUserEmailChange(auth.actor, auth.actor.id);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return routeError(error);
  }
}
