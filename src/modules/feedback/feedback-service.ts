import "server-only";

import type { FeedbackSource, Prisma } from "@/generated/prisma/client";
import { APP_VERSION } from "@/lib/app-version";
import type { Actor } from "@/lib/actor";
import { withActorDb, withSystemDb } from "@/lib/actor";
import { assertAllowed } from "@/modules/projects/errors";
import { createFeedbackIssue } from "@/modules/feedback/github-issues";
import {
  FEEDBACK_PAGE_SIZE_MAX,
  type ListFeedbackQuery,
  type SubmitFeedbackInput,
} from "@/modules/feedback/schemas";

const USER_AGENT_MAX = 400;

export const FEEDBACK_SOURCE_LABELS: Record<FeedbackSource, string> = {
  WEB: "Web 端",
  MINIAPP: "小程序",
};

export const FEEDBACK_ISSUE_STATUS_LABELS = {
  PENDING: "待同步",
  CREATED: "已建 issue",
  FAILED: "建 issue 失败",
  SKIPPED: "未同步（未配置）",
} as const;

export type FeedbackRow = {
  id: string;
  title: string;
  content: string;
  source: FeedbackSource;
  appVersion: string | null;
  platformInfo: Prisma.JsonValue | null;
  issueStatus: string;
  issueNumber: number | null;
  issueUrl: string | null;
  issueError: string | null;
  createdAt: string;
  submitter: {
    id: string;
    name: string;
    email: string;
    platformRole: string;
  } | null;
  // 服务端附带的中文标签：小程序简版列表直接渲染，不必复制状态字典。
  sourceLabel: string;
  issueStatusLabel: string;
};

export type FeedbackPage = {
  rows: FeedbackRow[];
  total: number;
  page: number;
  pageSize: number;
};

type PlatformInfo = Record<string, string>;

function miniappPlatformInfo(
  runtime: SubmitFeedbackInput["miniappRuntime"],
): PlatformInfo | null {
  if (!runtime) return null;
  const info: PlatformInfo = {};
  for (const [key, value] of Object.entries(runtime)) {
    if (value) info[key] = value;
  }
  return Object.keys(info).length > 0 ? info : null;
}

function webPlatformInfo(actor: Actor): PlatformInfo | null {
  if (!actor.userAgent) return null;
  return { userAgent: actor.userAgent.slice(0, USER_AGENT_MAX) };
}

function platformSummary(info: Prisma.JsonValue | null): string {
  if (!info || typeof info !== "object" || Array.isArray(info)) return "未知";
  const record = info as Record<string, unknown>;
  const parts: string[] = [];
  if (typeof record.model === "string" && record.model) {
    parts.push(record.model);
  }
  if (typeof record.system === "string" && record.system) {
    parts.push(record.system);
  }
  if (typeof record.userAgent === "string" && record.userAgent) {
    parts.push(record.userAgent.slice(0, USER_AGENT_MAX));
  }
  return parts.length > 0 ? parts.join(" · ") : "未知";
}

/** issue 正文 = 用户内容 + 环境信息。刻意不含提交人身份（公开仓库）。 */
export function buildFeedbackIssueBody(feedback: {
  content: string;
  source: FeedbackSource;
  appVersion: string | null;
  platformInfo: Prisma.JsonValue | null;
  id: string;
}): string {
  const lines = [
    feedback.content,
    "",
    "---",
    `来源：${FEEDBACK_SOURCE_LABELS[feedback.source]}`,
    `版本：${feedback.appVersion ?? "未知"}`,
    `平台：${platformSummary(feedback.platformInfo)}`,
    `反馈编号：${feedback.id}`,
  ];
  return lines.join("\n");
}

export type SubmitFeedbackResult = {
  id: string;
  /** GitHub issue 链接；未配置 token 或建 issue 失败时为 null（反馈本身已保存）。 */
  issueUrl: string | null;
};

export async function submitFeedback(
  actor: Actor,
  input: SubmitFeedbackInput,
  source: FeedbackSource,
): Promise<SubmitFeedbackResult> {
  const platformInfo =
    source === "MINIAPP"
      ? miniappPlatformInfo(input.miniappRuntime)
      : webPlatformInfo(actor);
  const appVersion =
    source === "MINIAPP" ? input.miniappRuntime?.appVersion ?? null : APP_VERSION;

  // 先落库（提交人身份随行保存），再同步 issue：通道失败也不丢用户反馈。
  // RLS：insert 策略要求 submitterId = 当前用户，客户/员工均可提交。
  const created = await withActorDb(actor, async (tx) =>
    tx.feedback.create({
      data: {
        title: input.title,
        content: input.content,
        source,
        appVersion,
        platformInfo: platformInfo ?? undefined,
        submitterId: actor.id,
      },
      select: {
        id: true,
        content: true,
        appVersion: true,
        platformInfo: true,
      },
    }),
  );

  const issue = await createFeedbackIssue({
    title: `[反馈] ${input.title}`,
    body: buildFeedbackIssueBody({
      content: created.content,
      source,
      appVersion: created.appVersion,
      platformInfo: created.platformInfo,
      id: created.id,
    }),
  });

  if (issue.status === "created") {
    await withSystemDb(async (tx) =>
      tx.feedback.update({
        where: { id: created.id },
        data: {
          issueStatus: "CREATED",
          issueNumber: issue.number,
          issueUrl: issue.url,
        },
      }),
    );
    return { id: created.id, issueUrl: issue.url };
  }

  // 系统身份回写同步结果（RLS：update 仅平台管理员/系统）。
  await withSystemDb(async (tx) =>
    tx.feedback.update({
      where: { id: created.id },
      data: {
        issueStatus: issue.status === "skipped" ? "SKIPPED" : "FAILED",
        issueError: issue.reason,
      },
    }),
  );
  return { id: created.id, issueUrl: null };
}

function buildWhere(
  filters: ListFeedbackQuery,
): Prisma.FeedbackWhereInput {
  const where: Prisma.FeedbackWhereInput = {};
  if (filters.source) where.source = filters.source;
  if (filters.issueStatus) where.issueStatus = filters.issueStatus;
  if (filters.search) {
    const search = filters.search.trim();
    if (search) {
      where.OR = [
        { title: { contains: search, mode: "insensitive" } },
        { content: { contains: search, mode: "insensitive" } },
        { submitter: { name: { contains: search, mode: "insensitive" } } },
        { submitter: { email: { contains: search, mode: "insensitive" } } },
      ];
    }
  }
  return where;
}

/**
 * 反馈列表仅员工可见 —— 服务层与 feedback_select RLS 策略双重把关。
 */
export async function listFeedback(
  actor: Actor,
  filters: ListFeedbackQuery,
): Promise<FeedbackPage> {
  assertAllowed(actor.isStaff, "反馈列表仅员工可见");

  const pageSize = Math.min(
    Math.max(filters.pageSize ?? 25, 1),
    FEEDBACK_PAGE_SIZE_MAX,
  );
  const page = Math.max(filters.page ?? 0, 0);
  const where = buildWhere(filters);

  return withActorDb(actor, async (tx) => {
    const [total, records] = await Promise.all([
      tx.feedback.count({ where }),
      tx.feedback.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: page * pageSize,
        take: pageSize,
        select: {
          id: true,
          title: true,
          content: true,
          source: true,
          appVersion: true,
          platformInfo: true,
          issueStatus: true,
          issueNumber: true,
          issueUrl: true,
          issueError: true,
          createdAt: true,
          submitter: {
            select: {
              id: true,
              name: true,
              email: true,
              platformRole: true,
            },
          },
        },
      }),
    ]);

    const rows: FeedbackRow[] = records.map((record) => ({
      ...record,
      createdAt: record.createdAt.toISOString(),
      sourceLabel: FEEDBACK_SOURCE_LABELS[record.source],
      issueStatusLabel:
        FEEDBACK_ISSUE_STATUS_LABELS[record.issueStatus] ?? record.issueStatus,
    }));

    return { rows, total, page, pageSize };
  });
}
