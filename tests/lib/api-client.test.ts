// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApiClientError,
  apiRequest,
  jsonRequest,
} from "@/lib/api-client";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("统一 API 客户端", () => {
  it("uses Ky JSON serialization without retries", async () => {
    let capturedRequest:
      | { url: string; method: string; body: unknown }
      | undefined;
    const fetchMock = vi.fn().mockImplementation(async (input: Request) => {
      capturedRequest = {
        url: input.url,
        method: input.method,
        body: await input.clone().json(),
      };
      return new Response(JSON.stringify({ data: { saved: true } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      apiRequest<{ saved: boolean }>(
        "/api/v1/example",
        jsonRequest("PATCH", { enabled: true }),
      ),
    ).resolves.toEqual({ saved: true });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(capturedRequest).toEqual({
      url: "http://localhost:3000/api/v1/example",
      method: "PATCH",
      body: { enabled: true },
    });
  });

  it("preserves API error details and reference id", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: "CONFLICT",
            message: "数据已经更新",
            details: { field: "status" },
            referenceId: "err_api_client",
          },
        }),
        { status: 409, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const error = await apiRequest("/api/v1/example").catch((reason) => reason);
    expect(error).toBeInstanceOf(ApiClientError);
    expect(error).toMatchObject({
      message: "数据已经更新。错误编号：err_api_client",
      code: "CONFLICT",
      details: { field: "status" },
      status: 409,
      referenceId: "err_api_client",
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("accepts successful empty responses", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
    await expect(
      apiRequest<void>("/api/v1/example", { method: "DELETE" }),
    ).resolves.toBeUndefined();
  });

  it("原样发送 FormData，不强制套用 JSON headers", async () => {
    let capturedForm: FormData | undefined;
    const fetchMock = vi.fn().mockImplementation(async (input: Request) => {
      capturedForm = await input.clone().formData();
      return new Response(JSON.stringify({ data: { id: "attachment-1" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const form = new FormData();
    form.append("file", "hello.txt");
    await expect(
      apiRequest<{ id: string }>("/api/v1/attachments", {
        method: "POST",
        body: form,
      }),
    ).resolves.toEqual({ id: "attachment-1" });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(capturedForm?.get("file")).toBe("hello.txt");
  });
});
