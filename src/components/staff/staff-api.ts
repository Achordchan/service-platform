"use client";

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
    error?: { message?: string } | string;
  };
  if (!response.ok || payload.data === undefined) {
    const message =
      typeof payload.error === "string"
        ? payload.error
        : payload.error?.message;
    throw new Error(message || "操作失败，请稍后重试");
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
