import { NextResponse } from "next/server";
import { ZodError } from "zod";
import type { Actor } from "@/lib/actor";
import { resolveApiActor } from "@/modules/http/api-actor";
import {
  unexpectedApiErrorResponse,
  type ApiErrorContext,
} from "@/lib/api-error";
import {
  readBoundedRequestBody,
  RequestBodyTooLargeError,
} from "@/modules/http/bounded-request-body";
import { DomainError } from "@/modules/projects/errors";
import { notificationDeliveryOverrideSchema } from "@/modules/notifications/notification-delivery-override";

type ActorResult =
  | { actor: Actor; response?: never }
  | { actor?: never; response: NextResponse };

export async function requireApiActor(): Promise<ActorResult> {
  try {
    const result = await resolveApiActor();
    if (result.failure) {
      return {
        response: NextResponse.json(
          { error: { code: result.failure.code, message: result.failure.message } },
          { status: 401 },
        ),
      };
    }
    return { actor: result.actor };
  } catch (error) {
    return {
      response: unexpectedApiErrorResponse(error, {
        source: "project-api",
        operation: "api_actor.resolve",
      }),
    };
  }
}

export async function readJson(
  request: Request,
  options: { maxBytes?: number } = {},
) {
  try {
    if (options.maxBytes !== undefined) {
      const body = await readBoundedRequestBody(request, options.maxBytes);
      return JSON.parse(new TextDecoder().decode(body));
    }
    return await request.json();
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      throw new DomainError(
        "REQUEST_BODY_TOO_LARGE",
        "请求体超过允许的大小",
        413,
      );
    }
    throw new DomainError("INVALID_JSON", "请求体不是有效的 JSON", 400);
  }
}

export function routeError(error: unknown, context?: Omit<ApiErrorContext, "source">) {
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
          ...(error.details === undefined ? {} : { details: error.details }),
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

  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2003"
  ) {
    return NextResponse.json(
      {
        error: {
          code: "RELATION_CONFLICT",
          message: "关联数据不存在或仍在使用，无法完成当前操作",
        },
      },
      { status: 409 },
    );
  }

  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2025"
  ) {
    return NextResponse.json(
      {
        error: {
          code: "NOT_FOUND",
          message: "记录不存在或已被删除",
        },
      },
      { status: 404 },
    );
  }

  return unexpectedApiErrorResponse(error, {
    source: "project-api",
    ...context,
  });
}

/**
 * 从写操作的请求体里取出本次的投递覆盖。
 *
 * 刻意不放进各领域的输入 schema：它不是实体字段，而是一条投递指令，
 * 混进去会污染「至少提交一个修改字段」这类校验。
 */
/**
 * 读取本次操作的送达覆盖 —— 仅员工可用。
 *
 * 客户也会打这些接口（工单公开回复、确认关闭），若无条件解析，客户就能构造
 * { notification: false } 把自己的回复对员工静音，或用 { email: true } 强制给
 * 已退订的员工发邮件。覆盖是员工写操作专用的能力，非员工一律当没传。
 * 服务层的 resolve*Plan 还会再丢一次，这里是第一道。
 */
export function readDeliveryOverride(actor: { isStaff: boolean }, body: unknown) {
  if (!actor.isStaff) return undefined;
  if (!body || typeof body !== "object") return undefined;
  const raw = (body as Record<string, unknown>).deliveryOverride;
  if (raw === undefined || raw === null) return undefined;
  return notificationDeliveryOverrideSchema.parse(raw);
}
