import "server-only";

import { ZodError } from "zod";
import {
  unexpectedApiErrorResponse,
  type ApiErrorContext,
} from "@/lib/api-error";
import { resolveApiActor } from "@/modules/http/api-actor";
import { DomainError } from "@/modules/projects/errors";
import { RequestDomainError } from "@/modules/requests/errors";

export async function requireApiActor() {
  const result = await resolveApiActor();
  if (result.failure) {
    throw new RequestDomainError(
      result.failure.code,
      result.failure.message,
      401,
    );
  }
  return result.actor;
}

export function apiErrorResponse(
  error: unknown,
  context?: Omit<ApiErrorContext, "source">,
) {
  if (error instanceof RequestDomainError) {
    return Response.json(
      { error: { code: error.code, message: error.message } },
      { status: error.status },
    );
  }
  if (error instanceof DomainError) {
    return Response.json(
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

  return unexpectedApiErrorResponse(error, {
    source: "request-api",
    ...context,
  });
}
