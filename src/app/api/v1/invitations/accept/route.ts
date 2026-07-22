import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { unexpectedApiErrorResponse } from "@/lib/api-error";
import { acceptInvitation } from "@/modules/invitations/invitation-service";

export async function POST(request: Request) {
  try {
    const result = await acceptInvitation(await request.json());
    return NextResponse.json({ data: result }, { status: 201 });
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json({ error: "提交的信息不完整" }, { status: 400 });
    }
    if (
      error instanceof Error &&
      (error.message === "INVITATION_INVALID" ||
        error.message === "MEMBER_LIMIT_REACHED")
    ) {
      return NextResponse.json(
        { error: error.message },
        { status: error.message === "INVITATION_INVALID" ? 410 : 409 },
      );
    }
    return unexpectedApiErrorResponse(error, {
      source: "invitation-api",
      operation: "invitation.accept",
      request,
    });
  }
}
