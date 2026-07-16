import { NextResponse } from "next/server";
import { z } from "zod";
import {
  cancelCustomerEmailChange,
  requestCustomerEmailChange,
} from "@/modules/users/customer-email-change-service";
import {
  readJson,
  requireApiActor,
  routeError,
} from "@/modules/projects/api-utils";

const schema = z.object({
  newEmail: z.string().trim().email().max(160),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ userId: string }> },
) {
  const auth = await requireApiActor();
  if (auth.response) return auth.response;
  try {
    const { userId } = await context.params;
    const input = schema.parse(await readJson(request));
    const result = await requestCustomerEmailChange(
      auth.actor,
      userId,
      input.newEmail,
    );
    return NextResponse.json({ data: result }, { status: 201 });
  } catch (error) {
    return routeError(error);
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ userId: string }> },
) {
  const auth = await requireApiActor();
  if (auth.response) return auth.response;
  try {
    const { userId } = await context.params;
    await cancelCustomerEmailChange(auth.actor, userId);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return routeError(error);
  }
}
