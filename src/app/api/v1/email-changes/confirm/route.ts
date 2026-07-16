import { NextResponse } from "next/server";
import { z } from "zod";
import { confirmCustomerEmailChange } from "@/modules/users/customer-email-change-service";
import { routeError } from "@/modules/projects/api-utils";

const schema = z.object({
  token: z.string().min(32).max(512),
});

export async function POST(request: Request) {
  try {
    const input = schema.parse(await request.json());
    const result = await confirmCustomerEmailChange(input.token);
    return NextResponse.json({ data: result });
  } catch (error) {
    return routeError(error);
  }
}
