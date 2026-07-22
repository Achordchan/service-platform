import { describe, expect, it, vi } from "vitest";
import { unexpectedApiErrorResponse } from "@/lib/api-error";

describe("API 意外错误响应", () => {
  it("返回可关联编号，并只写入脱敏的诊断字段", async () => {
    const error = new Error(
      "Unknown argument `emailEligible`. password=not-for-logs",
    );
    error.name = "PrismaClientValidationError";
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = unexpectedApiErrorResponse(error, {
      source: "project-api",
      operation: "project_update.create",
      request: new Request("https://support.achord.cn/api/v1/projects/a/updates?token=hidden", {
        method: "POST",
      }),
    });
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(response.headers.get("X-Achord-Error-Id")).toMatch(/^err_[a-f0-9]{32}$/);
    expect(payload).toMatchObject({
      error: {
        code: "INTERNAL_ERROR",
        referenceId: response.headers.get("X-Achord-Error-Id"),
      },
    });
    expect(payload.error.message).toContain(payload.error.referenceId);
    expect(consoleError).toHaveBeenCalledOnce();
    const logged = String(consoleError.mock.calls[0]?.[1]);
    expect(logged).toContain('"unknownArgument":"emailEligible"');
    expect(logged).toContain('"category":"DATABASE_SCHEMA"');
    expect(logged).toContain('"path":"/api/v1/projects/a/updates"');
    expect(logged).not.toContain("not-for-logs");
    expect(logged).not.toContain("token=hidden");
    consoleError.mockRestore();
  });

  it("会脱敏堆栈和路径中的敏感片段", () => {
    const error = new Error("failure");
    error.stack = [
      "Error: failure",
      "at handler (authorization=Bearer-secret)",
    ].join("\n");
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    unexpectedApiErrorResponse(error, {
      source: "request-api",
      request: new Request(
        "https://support.achord.cn/api/v1/requests/token=hidden",
      ),
    });

    const logged = String(consoleError.mock.calls[0]?.[1]);
    expect(logged).toContain("[REDACTED]");
    expect(logged).not.toContain("Bearer-secret");
    expect(logged).not.toContain("token=hidden");
    consoleError.mockRestore();
  });
});
