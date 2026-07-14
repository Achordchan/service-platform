import { NextResponse } from "next/server";
import { ZodError } from "zod";
import type { Actor } from "@/lib/actor";
import { resolveActor } from "@/lib/actor";
import { getCurrentSession } from "@/lib/session";
import { DomainError } from "@/modules/projects/errors";

type ActorResult =
  | { actor: Actor; response?: never }
  | { actor?: never; response: NextResponse };

export async function requireApiActor(): Promise<ActorResult> {
  const session = await getCurrentSession();
  if (!session) {
    return {
      response: NextResponse.json(
        { error: { code: "UNAUTHORIZED", message: "请先登录" } },
        { status: 401 },
      ),
    };
  }

  const actor = await resolveActor(session.user.id);
  if (!actor) {
    return {
      response: NextResponse.json(
        { error: { code: "UNAUTHORIZED", message: "当前账号不可用" } },
        { status: 401 },
      ),
    };
  }

  return { actor };
}

export async function readJson(request: Request) {
  try {
    return await request.json();
  } catch {
    throw new DomainError("INVALID_JSON", "请求体不是有效的 JSON", 400);
  }
}

export function routeError(error: unknown) {
  if (error instanceof ZodError) {
    return NextResponse.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "提交的数据不符合要求",
          issues: error.issues,
        },
      },
      { status: 422 },
    );
  }

  if (error instanceof DomainError) {
    return NextResponse.json(
      {
        error: {
          code: error.code,
          message: error.message,
        },
      },
      { status: error.status },
    );
  }

  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2002"
  ) {
    return NextResponse.json(
      {
        error: {
          code: "CONFLICT",
          message: "提交的数据与现有记录冲突",
        },
      },
      { status: 409 },
    );
  }

  console.error(error);
  return NextResponse.json(
    { error: { code: "INTERNAL_ERROR", message: "服务器处理失败" } },
    { status: 500 },
  );
}
