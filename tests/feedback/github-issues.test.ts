import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  env: {
    GITHUB_FEEDBACK_TOKEN: undefined as string | undefined,
    GITHUB_FEEDBACK_REPO: undefined as string | undefined,
  },
}));

vi.mock("server-only", () => ({}));

vi.mock("@/lib/env", () => ({
  env: mocks.env,
}));

import { createFeedbackIssue } from "@/modules/feedback/github-issues";

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

beforeEach(() => {
  vi.stubGlobal("fetch", mocks.fetch);
  mocks.env.GITHUB_FEEDBACK_TOKEN = "gh_test_token";
  mocks.env.GITHUB_FEEDBACK_REPO = undefined;
  mocks.fetch.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createFeedbackIssue", () => {
  it("未配置 token 时跳过（不发起请求）", async () => {
    mocks.env.GITHUB_FEEDBACK_TOKEN = undefined;

    const result = await createFeedbackIssue({
      title: "[反馈] 标题",
      body: "内容",
    });

    expect(result).toEqual({
      status: "skipped",
      reason: "未配置 GITHUB_FEEDBACK_TOKEN",
    });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("成功创建：带 feedback label、Bearer 认证、返回编号与链接", async () => {
    mocks.fetch.mockResolvedValueOnce(
      jsonResponse({
        number: 42,
        html_url: "https://github.com/Achordchan/service-platform/issues/42",
      }),
    );

    const result = await createFeedbackIssue({
      title: "[反馈] 标题",
      body: "内容",
    });

    expect(result).toEqual({
      status: "created",
      number: 42,
      url: "https://github.com/Achordchan/service-platform/issues/42",
    });

    const [url, init] = mocks.fetch.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe(
      "https://api.github.com/repos/Achordchan/service-platform/issues",
    );
    expect(init.method).toBe("POST");
    expect(
      (init.headers as Record<string, string>).Authorization,
    ).toBe("Bearer gh_test_token");
    expect(JSON.parse(String(init.body))).toEqual({
      title: "[反馈] 标题",
      body: "内容",
      labels: ["feedback"],
    });
  });

  it("配置了 GITHUB_FEEDBACK_REPO 时请求指定仓库", async () => {
    mocks.env.GITHUB_FEEDBACK_REPO = "acme/private-tracker";
    mocks.fetch.mockResolvedValueOnce(
      jsonResponse({ number: 1, html_url: "https://github.com/acme/private-tracker/issues/1" }),
    );

    await createFeedbackIssue({ title: "t", body: "b" });

    expect(mocks.fetch.mock.calls[0][0]).toBe(
      "https://api.github.com/repos/acme/private-tracker/issues",
    );
  });

  it("label 校验失败（422）时去掉 label 重试一次", async () => {
    mocks.fetch
      .mockResolvedValueOnce(jsonResponse({ message: "Validation Failed" }, 422))
      .mockResolvedValueOnce(
        jsonResponse({ number: 7, html_url: "https://github.com/x/y/issues/7" }),
      );

    const result = await createFeedbackIssue({ title: "t", body: "b" });

    expect(result).toEqual({
      status: "created",
      number: 7,
      url: "https://github.com/x/y/issues/7",
    });
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    const [, retryInit] = mocks.fetch.mock.calls[1] as unknown as [
      string,
      RequestInit,
    ];
    const retryBody = JSON.parse(String(retryInit.body));
    expect(retryBody.labels).toBeUndefined();
  });

  it("重试仍失败时返回 failed", async () => {
    mocks.fetch
      .mockResolvedValueOnce(jsonResponse({ message: "Validation Failed" }, 422))
      .mockResolvedValueOnce(jsonResponse({ message: "Validation Failed" }, 422));

    const result = await createFeedbackIssue({ title: "t", body: "b" });

    expect(result.status).toBe("failed");
  });

  it("token 无效（401）返回 failed 且不重试", async () => {
    mocks.fetch.mockResolvedValueOnce(
      jsonResponse({ message: "Bad credentials" }, 401),
    );

    const result = await createFeedbackIssue({ title: "t", body: "b" });

    expect(result).toEqual({
      status: "failed",
      reason: "GitHub token 无效或已过期",
    });
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });

  it("网络错误返回 failed 而不抛异常", async () => {
    mocks.fetch.mockRejectedValueOnce(new Error("ECONNRESET"));

    const result = await createFeedbackIssue({ title: "t", body: "b" });

    expect(result).toEqual({
      status: "failed",
      reason: "无法连接 GitHub",
    });
  });

  it("响应缺 html_url 视为失败", async () => {
    mocks.fetch.mockResolvedValueOnce(jsonResponse({ number: 9 }));

    const result = await createFeedbackIssue({ title: "t", body: "b" });

    expect(result.status).toBe("failed");
  });
});
