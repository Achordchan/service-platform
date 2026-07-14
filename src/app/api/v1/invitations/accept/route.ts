import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { acceptInvitation } from "@/modules/invitations/invitation-service";

export async function POST(request: Request) {
  try {
    const result = await acceptInvitation(await request.json());
    return NextResponse.json({ data: result }, { status: 201 });
  } catch (error) {
    const message =
      error instanceof ZodError
        ? "提交的信息不完整"
        : error instanceof Error
          ? error.message
          : "INVITATION_ACCEPT_FAILED";
    const status =
      message === "INVITATION_INVALID"
        ? 410
        : message === "MEMBER_LIMIT_REACHED"
          ? 409
          : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
