"use client";

export class StaffApiError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
    public readonly details?: unknown,
    public readonly status?: number,
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
  const payload = (await response.json().catch(() => ({}))) as {
    data?: T;
    error?: { code?: string; message?: string; details?: unknown } | string;
  };
  if (!response.ok || payload.data === undefined) {
    const message =
      typeof payload.error === "string"
        ? payload.error
        : payload.error?.message;
    throw new StaffApiError(
      message || "操作失败，请稍后重试",
      typeof payload.error === "string" ? undefined : payload.error?.code,
      typeof payload.error === "string" ? undefined : payload.error?.details,
      response.status,
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
