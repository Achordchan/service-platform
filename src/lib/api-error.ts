import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import {
  describeErrorForLog,
  redactPath,
  safeIdentifier,
} from "@/lib/error-log";

export type ApiErrorContext = {
  operation?: string;
  request?: Request;
  source: string;
};

const MAX_PATH_LENGTH = 320;

function requestContext(request?: Request) {
  if (!request) return undefined;
  try {
    const url = new URL(request.url);
    return {
      method: request.method,
      path: redactPath(url.pathname).slice(0, MAX_PATH_LENGTH),
    };
  } catch {
    return { method: request.method };
  }
}

export function unexpectedApiErrorResponse(
  error: unknown,
  context: ApiErrorContext,
) {
  const referenceId = `err_${randomUUID().replaceAll("-", "")}`;
  const source = safeIdentifier(context.source) ?? "api";
  const operation = safeIdentifier(context.operation);
  const request = requestContext(context.request);

  console.error(
    "ACHORD_API_UNEXPECTED_ERROR",
    JSON.stringify({
      event: "api.unexpected_error",
      referenceId,
      source,
      ...(operation ? { operation } : {}),
      ...(request ? { request } : {}),
      error: describeErrorForLog(error),
    }),
  );

  return NextResponse.json(
    {
      error: {
        code: "INTERNAL_ERROR",
        message: `操作暂时失败，请稍后重试。错误编号：${referenceId}`,
        referenceId,
      },
    },
    {
      status: 500,
      headers: {
        "Cache-Control": "no-store",
        "X-Achord-Error-Id": referenceId,
      },
    },
  );
}
