"use client";

import ky, { type Options } from "ky";
import {
  apiErrorMessage,
  apiErrorReferenceId,
  readApiJson,
  type ApiResponsePayload,
} from "@/lib/api-client-error";

export type ApiRequestOptions = Options;

const apiHttp = ky.create({
  retry: 0,
  timeout: false,
  throwHttpErrors: false,
});

export class ApiClientError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
    public readonly details?: unknown,
    public readonly status?: number,
    public readonly referenceId?: string,
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

function resolveApiInput(input: string | URL) {
  if (input instanceof URL || typeof window === "undefined") return input;
  return new URL(input, window.location.href);
}

export async function apiRequest<T>(
  input: string | URL,
  options?: ApiRequestOptions,
  fallback = "操作失败，请稍后重试",
): Promise<T> {
  const response = await apiHttp(resolveApiInput(input), options);
  if (response.status === 204) {
    return undefined as T;
  }
  const payload = await readApiJson<ApiResponsePayload<T>>(response);
  if (!response.ok || payload?.data === undefined) {
    const error = payload?.error;
    throw new ApiClientError(
      apiErrorMessage(response, payload, fallback),
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
  return {
    method,
    json: body,
  } satisfies ApiRequestOptions;
}
