import { describe, expect, it, vi } from "vitest";
import { DomainError } from "@/modules/projects/errors";
import { apiErrorResponse } from "@/modules/requests/api";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/actor", () => ({ resolveActor: vi.fn() }));
vi.mock("@/lib/session", () => ({ getCurrentSession: vi.fn() }));

describe("服务请求 API 错误响应", () => {
  it("保留跨模块业务错误的状态、编码和明确提示", async () => {
    const response = apiErrorResponse(
      new DomainError(
        "CONTACT_INFORMATION_BLOCKED",
        "内容疑似包含联系方式或站外交易引导，已阻止发送。请继续通过平台沟通。",
        422,
      ),
    );

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "CONTACT_INFORMATION_BLOCKED",
        message:
          "内容疑似包含联系方式或站外交易引导，已阻止发送。请继续通过平台沟通。",
      },
    });
  });
});
