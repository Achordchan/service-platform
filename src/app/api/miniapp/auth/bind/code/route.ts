import { NextResponse } from "next/server";
import { miniappBindCodeSchema } from "@/modules/miniapp/schemas";
import { bindTicketToCode } from "@/modules/miniapp/wechat-binding-service";
import { readJson, routeError } from "@/modules/projects/api-utils";

export async function POST(request: Request) {
  try {
    const input = miniappBindCodeSchema.parse(
      await readJson(request, { maxBytes: 8 * 1024 }),
    );
    const result = await bindTicketToCode(input);
    return NextResponse.json({
      data: {
        token: result.token,
        expiresAt: result.expiresAt,
        user: result.user,
      },
    });
  } catch (error) {
    return routeError(error, {
      request,
      operation: "miniapp.auth.bind.code",
    });
  }
}
