import { describe, expect, it } from "vitest";
import {
  readBoundedFormData,
  RequestBodyTooLargeError,
} from "@/modules/attachments/bounded-form-data";

describe("bounded multipart form data", () => {
  it("parses a multipart request below the hard body limit", async () => {
    const formData = new FormData();
    formData.set("serviceRequestId", "request-1");
    formData.set("file", new File(["hello"], "hello.txt", { type: "text/plain" }));
    const request = new Request("https://support.example.test/upload", {
      method: "POST",
      body: formData,
    });

    const parsed = await readBoundedFormData(request, 1024 * 1024);
    expect(parsed.get("serviceRequestId")).toBe("request-1");
    expect(parsed.get("file")).toBeInstanceOf(File);
  });

  it("rejects the actual body size even when Content-Length is forged", async () => {
    const request = new Request("https://support.example.test/upload", {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Length": "1",
      },
      body: new Uint8Array(2048),
    });

    await expect(readBoundedFormData(request, 1024)).rejects.toBeInstanceOf(
      RequestBodyTooLargeError,
    );
  });

  it("rejects an oversized declared body before parsing", async () => {
    const request = new Request("https://support.example.test/upload", {
      method: "POST",
      headers: { "Content-Length": "2048" },
    });

    await expect(readBoundedFormData(request, 1024)).rejects.toBeInstanceOf(
      RequestBodyTooLargeError,
    );
  });
});
