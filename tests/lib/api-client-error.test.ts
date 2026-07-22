import { describe, expect, it } from "vitest";
import {
  apiErrorMessage,
  apiErrorReferenceId,
  readApiJson,
  type ApiResponsePayload,
} from "@/lib/api-client-error";

describe("客户端 API 错误信息", () => {
  it("优先使用服务端错误编号，且不会重复追加", async () => {
    const response = new Response(
      JSON.stringify({
        error: {
          message: "操作暂时失败。错误编号：err_existing",
          referenceId: "err_existing",
        },
      }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
    const payload = await readApiJson<ApiResponsePayload>(response);

    expect(apiErrorReferenceId(response, payload)).toBe("err_existing");
    expect(apiErrorMessage(response, payload, "操作失败")).toBe(
      "操作暂时失败。错误编号：err_existing",
    );
  });

  it("网关返回非 JSON 时给出可理解的状态信息", async () => {
    const response = new Response("<html>bad gateway</html>", {
      status: 502,
      headers: { "X-Achord-Error-Id": "err_gateway" },
    });
    const payload = await readApiJson<ApiResponsePayload>(response);

    expect(payload).toBeUndefined();
    expect(apiErrorMessage(response, payload, "操作失败")).toBe(
      "服务暂时不可用（HTTP 502），请稍后重试。错误编号：err_gateway",
    );
  });
});
