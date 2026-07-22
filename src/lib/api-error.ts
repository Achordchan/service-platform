import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

export type ApiErrorContext = {
  operation?: string;
  request?: Request;
  source: string;
};

type ErrorRecord = Record<string, unknown>;

const MAX_STACK_FRAMES = 4;
const MAX_PATH_LENGTH = 320;
const SENSITIVE_LOG_VALUE = /\b(password|passphrase|token|secret|authorization|api[_-]?key)\s*[:=]\s*[^\s,;]+/gi;

function asRecord(value: unknown): ErrorRecord | null {
  return typeof value === "object" && value !== null
    ? (value as ErrorRecord)
    : null;
}

function safeIdentifier(value: unknown) {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return /^[A-Za-z][A-Za-z0-9_.-]{0,127}$/.test(normalized)
    ? normalized
    : undefined;
}

function redactSensitiveText(value: string) {
  return value.replace(SENSITIVE_LOG_VALUE, "$1=[REDACTED]");
}

function safePrismaDiagnostic(error: unknown) {
  const record = asRecord(error);
  const code = safeIdentifier(record?.code);
  const meta = asRecord(record?.meta);
  const model = safeIdentifier(meta?.modelName);
  const message = error instanceof Error ? error.message : "";
  const unknownArgument = message.match(/Unknown argument `([A-Za-z][A-Za-z0-9_]*)`/);
  const missingColumn = message.match(
    /The column `([A-Za-z][A-Za-z0-9_.]*)` does not exist/,
  );

  return {
    ...(code ? { code } : {}),
    ...(model ? { model } : {}),
    ...(unknownArgument ? { unknownArgument: unknownArgument[1] } : {}),
    ...(missingColumn ? { missingColumn: missingColumn[1] } : {}),
  };
}

function safeStackFrames(error: unknown) {
  if (!(error instanceof Error) || !error.stack) return [];
  return error.stack
    .split("\n")
    .slice(1, MAX_STACK_FRAMES + 1)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => redactSensitiveText(line).slice(0, 320));
}

function requestContext(request?: Request) {
  if (!request) return undefined;
  try {
    const url = new URL(request.url);
    return {
      method: request.method,
      path: redactSensitiveText(url.pathname).slice(0, MAX_PATH_LENGTH),
    };
  } catch {
    return { method: request.method };
  }
}

function errorCategory(error: unknown, diagnostic: ReturnType<typeof safePrismaDiagnostic>) {
  if (
    diagnostic.missingColumn ||
    diagnostic.unknownArgument ||
    diagnostic.code === "P2021" ||
    diagnostic.code === "P2022"
  ) {
    return "DATABASE_SCHEMA";
  }
  if (
    diagnostic.code === "P1000" ||
    diagnostic.code === "P1001" ||
    diagnostic.code === "P1002" ||
    diagnostic.code === "P1017"
  ) {
    return "DATABASE_CONNECTION";
  }
  if (error instanceof SyntaxError) return "INVALID_SERVER_RESPONSE";
  return "UNEXPECTED";
}

/**
 * Logs only stable diagnostics. Request bodies, credentials, headers, and raw
 * provider errors intentionally stay out of this record.
 */
export function unexpectedApiErrorResponse(
  error: unknown,
  context: ApiErrorContext,
) {
  const referenceId = `err_${randomUUID().replaceAll("-", "")}`;
  const name =
    error instanceof Error
      ? safeIdentifier(error.name) ?? "Error"
      : "NonErrorThrown";
  const diagnostic = safePrismaDiagnostic(error);
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
      error: {
        name,
        category: errorCategory(error, diagnostic),
        ...diagnostic,
        stackFrames: safeStackFrames(error),
      },
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
