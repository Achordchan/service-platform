"use client";

type ApiErrorObject = {
  code?: string;
  message?: string;
  details?: unknown;
  referenceId?: string;
};

export type ApiResponsePayload<T = unknown> = {
  data?: T;
  error?: ApiErrorObject | string;
};

export async function readApiJson<T>(response: Response): Promise<T | undefined> {
  try {
    return (await response.json()) as T;
  } catch {
    return undefined;
  }
}

export function apiErrorReferenceId(
  response: Response,
  payload?: ApiResponsePayload,
) {
  if (typeof payload?.error === "object" && payload.error !== null) {
    const referenceId = payload.error.referenceId?.trim();
    if (referenceId) return referenceId;
  }
  return response.headers.get("X-Achord-Error-Id")?.trim() || undefined;
}

export function apiErrorMessage(
  response: Response,
  payload: ApiResponsePayload | undefined,
  fallback: string,
) {
  const message =
    typeof payload?.error === "string"
      ? payload.error
      : payload?.error?.message;
  const referenceId = apiErrorReferenceId(response, payload);
  const base =
    message?.trim() ||
    (response.status >= 500
      ? `服务暂时不可用（HTTP ${response.status}），请稍后重试`
      : fallback);
  return referenceId && !base.includes(referenceId)
    ? `${base}。错误编号：${referenceId}`
    : base;
}
