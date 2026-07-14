import "server-only";

import { ZodError } from "zod";
import { resolveActor } from "@/lib/actor";
import { getCurrentSession } from "@/lib/session";
import { RequestDomainError } from "@/modules/requests/errors";

export async function requireApiActor() {
  const session = await getCurrentSession();
  if (!session) {
    throw new RequestDomainError("UNAUTHORIZED", "请先登录", 401);
  }
  const actor = await resolveActor(session.user.id);
  if (!actor) {
    throw new RequestDomainError("UNAUTHORIZED", "登录用户不存在", 401);
  }
  return actor;
}

export function apiErrorResponse(error: unknown) {
  if (error instanceof RequestDomainError) {
    return Response.json(
      { error: { code: error.code, message: error.message } },
      { status: error.status },
    );
  }
  if (error instanceof ZodError) {
    return Response.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "请求参数不合法",
          issues: error.issues,
        },
      },
      { status: 400 },
    );
  }
  if (error instanceof SyntaxError) {
    return Response.json(
      {
        error: {
          code: "INVALID_JSON",
          message: "请求体不是有效的 JSON",
        },
      },
      { status: 400 },
    );
  }

  console.error(error);
  return Response.json(
    { error: { code: "INTERNAL_ERROR", message: "服务器处理失败" } },
    { status: 500 },
  );
}
