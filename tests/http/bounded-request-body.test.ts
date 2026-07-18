import { describe, expect, it } from "vitest";
import {
  readBoundedRequestBody,
  RequestBodyTooLargeError,
} from "@/modules/http/bounded-request-body";

describe("bounded request body", () => {
  it("reads a request below the configured limit", async () => {
    const request = new Request("https://support.example.test/api", {
      method: "POST",
      body: JSON.stringify({ value: "ok" }),
    });
    const body = await readBoundedRequestBody(request, 1024);
    expect(new TextDecoder().decode(body)).toBe('{"value":"ok"}');
  });

  it("rejects actual bytes even with a forged Content-Length", async () => {
    const request = new Request("https://support.example.test/api", {
      method: "POST",
      headers: { "Content-Length": "1" },
      body: "x".repeat(2048),
    });
    await expect(readBoundedRequestBody(request, 1024)).rejects.toBeInstanceOf(
      RequestBodyTooLargeError,
    );
  });
});
