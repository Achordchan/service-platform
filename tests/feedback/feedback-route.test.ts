import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireApiActor: vi.fn(),
  checkRateLimit: vi.fn(),
  findFeedbackByMutationKey: vi.fn(),
  submitFeedback: vi.fn(),
}));

vi.mock("server-only", () => ({}));

// readJson 真实实现会拖出 api-actor → db → env 整条链，路由只用到它
vi.mock("@/modules/projects/api-utils", () => ({
  readJson: async (request: Request) => request.json(),
}));

vi.mock("@/modules/requests/api", () => ({
  requireApiActor: mocks.requireApiActor,
  apiErrorResponse: (error: {
    code?: string;
    message?: string;
    status?: number;
  }) =>
    Response.json(
      {
        error: {
          code: error.code ?? "INTERNAL",
          message: error.message ?? "服务器处理失败",
        },
      },
      { status: error.status ?? 500 },
    ),
}));

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: mocks.checkRateLimit,
}));

vi.mock("@/modules/feedback/feedback-service", () => ({
  findFeedbackByMutationKey: mocks.findFeedbackByMutationKey,
  submitFeedback: mocks.submitFeedback,
}));

import { POST } from "@/app/api/v1/feedback/route";

const customerActor = {
  id: "customer-1",
  name: "客户乙",
  email: "customer@example.test",
  platformRole: "CUSTOMER",
  isStaff: false,
  isPlatformAdmin: false,
};

function post(body: unknown) {
  return POST(
    new Request("http://localhost/api/v1/feedback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireApiActor.mockResolvedValue(customerActor);
  mocks.checkRateLimit.mockReturnValue(true);
  mocks.findFeedbackByMutationKey.mockResolvedValue(null);
  mocks.submitFeedback.mockResolvedValue({ id: "fb-new", issueUrl: null });
});

describe("反馈提交路由的幂等与限流顺序", () => {
  it("同 key 命中已有反馈：直接返回，不耗限流额度也不再提交", async () => {
    mocks.findFeedbackByMutationKey.mockResolvedValue({
      id: "fb-existing",
      issueUrl: "https://github.com/o/r/issues/7",
    });

    const response = await post({
      title: "t",
      content: "c",
      clientMutationKey: "ma-key-1",
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual({
      id: "fb-existing",
      issueUrl: "https://github.com/o/r/issues/7",
    });
    expect(mocks.checkRateLimit).not.toHaveBeenCalled();
    expect(mocks.submitFeedback).not.toHaveBeenCalled();
  });

  it("预检未命中：走限流 + 正常提交，key 透传给服务层", async () => {
    const response = await post({
      title: "t",
      content: "c",
      clientMutationKey: "ma-key-2",
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual({ id: "fb-new", issueUrl: null });
    expect(mocks.checkRateLimit).toHaveBeenCalledTimes(1);
    expect(mocks.submitFeedback).toHaveBeenCalledWith(
      customerActor,
      { title: "t", content: "c", clientMutationKey: "ma-key-2" },
      "WEB",
    );
  });

  it("限流触发时返回 429，不落库", async () => {
    mocks.checkRateLimit.mockReturnValue(false);

    const response = await post({ title: "t", content: "c" });
    const body = await response.json();

    expect(response.status).toBe(429);
    expect(body.error.code).toBe("RATE_LIMITED");
    expect(mocks.submitFeedback).not.toHaveBeenCalled();
  });

  it("不带 key 不做预检，直接限流 + 提交", async () => {
    await post({ title: "t", content: "c" });

    expect(mocks.findFeedbackByMutationKey).not.toHaveBeenCalled();
    expect(mocks.submitFeedback).toHaveBeenCalledTimes(1);
  });
});
