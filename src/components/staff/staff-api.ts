"use client";

import {
  apiErrorMessage,
  apiErrorReferenceId,
  readApiJson,
  type ApiResponsePayload,
} from "@/lib/api-client-error";

export class StaffApiError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
    public readonly details?: unknown,
    public readonly status?: number,
    public readonly referenceId?: string,
  ) {
    super(message);
    this.name = "StaffApiError";
  }
}

export async function staffApi<T>(
  url: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(url, init);
  if (response.status === 204) {
    return undefined as T;
  }
  const payload = await readApiJson<ApiResponsePayload<T>>(response);
  if (!response.ok || payload?.data === undefined) {
    const error = payload?.error;
    throw new StaffApiError(
      apiErrorMessage(response, payload, "操作失败，请稍后重试"),
      typeof error === "string" ? undefined : error?.code,
      typeof error === "string" ? undefined : error?.details,
      response.status,
      apiErrorReferenceId(response, payload),
    );
  }
  return payload.data;
}

export function jsonRequest(
  method: "POST" | "PATCH" | "PUT" | "DELETE",
  body?: unknown,
) {
  if (method === "DELETE" && body === undefined) {
    return { method } satisfies RequestInit;
  }
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  } satisfies RequestInit;
}
