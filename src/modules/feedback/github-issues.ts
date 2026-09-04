import "server-only";

import { env } from "@/lib/env";

export const FEEDBACK_ISSUE_LABEL = "feedback";

const DEFAULT_FEEDBACK_REPO = "Achordchan/service-platform";
const GITHUB_ISSUES_TIMEOUT_MS = 10_000;

export type FeedbackIssueResult =
  | { status: "created"; number: number; url: string }
  | { status: "skipped"; reason: string }
  | { status: "failed"; reason: string };

type PostIssueOutcome =
  | { ok: true; number: number; url: string }
  | { ok: false; httpStatus: number; reason: string };

export function feedbackIssueChannelConfigured(): boolean {
  return Boolean(env.GITHUB_FEEDBACK_TOKEN);
}

function feedbackRepo(): string {
  return env.GITHUB_FEEDBACK_REPO ?? DEFAULT_FEEDBACK_REPO;
}

function reasonForStatus(status: number): string {
  switch (status) {
    case 401:
      return "GitHub token 无效或已过期";
    case 403:
      return "GitHub 拒绝访问（token 权限不足或触发限流）";
    case 404:
      return "目标仓库不存在或 token 无权访问";
    case 422:
      return "GitHub 校验失败";
    default:
      return status >= 500 ? "GitHub 服务暂不可用" : `GitHub 返回 ${status}`;
  }
}

async function postIssue(
  title: string,
  body: string,
  labels: string[] | null,
): Promise<PostIssueOutcome> {
  try {
    const response = await fetch(
      `https://api.github.com/repos/${feedbackRepo()}/issues`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.GITHUB_FEEDBACK_TOKEN}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          title,
          body,
          ...(labels ? { labels } : {}),
        }),
        signal: AbortSignal.timeout(GITHUB_ISSUES_TIMEOUT_MS),
      },
    );

    if (!response.ok) {
      return {
        ok: false,
        httpStatus: response.status,
        reason: reasonForStatus(response.status),
      };
    }

    const payload = (await response.json()) as {
      number?: number;
      html_url?: string;
    };
    if (typeof payload.number !== "number" || !payload.html_url) {
      return {
        ok: false,
        httpStatus: 0,
        reason: "GitHub 响应缺少 issue 编号或链接",
      };
    }
    return { ok: true, number: payload.number, url: payload.html_url };
  } catch (error) {
    return {
      ok: false,
      httpStatus: 0,
      reason:
        error instanceof Error && error.name === "TimeoutError"
          ? "GitHub 请求超时"
          : "无法连接 GitHub",
    };
  }
}

/**
 * 创建反馈 issue。失败不抛异常：反馈落库是事实源，issue 通道挂了
 * 只降级（无链接、行上记 FAILED/SKIPPED），绝不影响用户提交结果。
 */
export async function createFeedbackIssue(params: {
  title: string;
  body: string;
}): Promise<FeedbackIssueResult> {
  if (!env.GITHUB_FEEDBACK_TOKEN) {
    return { status: "skipped", reason: "未配置 GITHUB_FEEDBACK_TOKEN" };
  }

  const withLabel = await postIssue(
    params.title,
    params.body,
    [FEEDBACK_ISSUE_LABEL],
  );
  if (withLabel.ok) {
    return {
      status: "created",
      number: withLabel.number,
      url: withLabel.url,
    };
  }

  // 422 多半是 label 不存在（仓库删了 feedback label）；此时 issue 尚未创建，
  // 去掉 label 重试一次是安全的。其余状态码重试没有意义。
  if (withLabel.httpStatus === 422) {
    const withoutLabel = await postIssue(params.title, params.body, null);
    if (withoutLabel.ok) {
      return {
        status: "created",
        number: withoutLabel.number,
        url: withoutLabel.url,
      };
    }
    return { status: "failed", reason: withoutLabel.reason };
  }

  console.warn(
    JSON.stringify({
      tag: "FEEDBACK_GITHUB_ISSUE_FAILED",
      repo: feedbackRepo(),
      httpStatus: withLabel.httpStatus,
      reason: withLabel.reason,
    }),
  );
  return { status: "failed", reason: withLabel.reason };
}
