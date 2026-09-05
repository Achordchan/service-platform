import "server-only";

import type { FeedbackSource, Prisma } from "@/generated/prisma/client";
import { APP_VERSION } from "@/lib/app-version";
import type { Actor } from "@/lib/actor";
import { withActorDb, withSystemDb } from "@/lib/actor";
import { assertAllowed, DomainError } from "@/modules/projects/errors";
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
  // 弱网重试防重（与 ServiceRequest 同一套约定）：同 key 命中直接返回
  // 已建反馈（含它当时的 issue 链接），不再建第二条——否则重试一次就
  // 多同步出一个公开 GitHub issue。
  if (input.clientMutationKey) {
    const existing = await findFeedbackByMutationKey(
      actor,
      input.clientMutationKey,
      { title: input.title, content: input.content },
    );
    if (existing) return existing;
  }

  const platformInfo =
    source === "MINIAPP"
      ? miniappPlatformInfo(input.miniappRuntime)
      : webPlatformInfo(actor);
  const appVersion =
    source === "MINIAPP" ? input.miniappRuntime?.appVersion ?? null : APP_VERSION;

  // 先落库（提交人身份随行保存），再同步 issue：通道失败也不丢用户反馈。
  // RLS：insert 策略要求 submitterId = 当前用户，客户/员工均可提交。
  let created: {
    id: string;
    content: string;
    appVersion: string | null;
    platformInfo: Prisma.JsonValue | null;
  };
  try {
    created = await withActorDb(actor, async (tx) =>
      tx.feedback.create({
        data: {
          title: input.title,
          content: input.content,
          source,
          appVersion,
          platformInfo: platformInfo ?? undefined,
          submitterId: actor.id,
          clientMutationKey: input.clientMutationKey ?? null,
        },
        select: {
          id: true,
          content: true,
          appVersion: true,
          platformInfo: true,
        },
      }),
    );
  } catch (error) {
    // 并发同 key：另一请求已写入，唯一约束兜底后返回已有反馈
    if (input.clientMutationKey && isPrismaUniqueViolationError(error)) {
      const existing = await findFeedbackByMutationKey(
        actor,
        input.clientMutationKey,
        { title: input.title, content: input.content },
      );
      if (existing) return existing;
    }
    throw error;
  }

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
    await writeIssueStatus(created.id, {
      issueStatus: "CREATED",
      issueNumber: issue.number,
      issueUrl: issue.url,
    });
    return { id: created.id, issueUrl: issue.url };
  }

  if (issue.status === "unknown") {
    // 结果未知（超时/断网/5xx）：issue 可能已建。停在 PENDING 只记原因，
    // 绝不标 FAILED——标了容易有人按「失败」重试，在公开仓库建出重复 issue。
    await writeIssueStatus(created.id, { issueError: issue.reason });
    return { id: created.id, issueUrl: null };
  }

  await writeIssueStatus(created.id, {
    issueStatus: issue.status === "skipped" ? "SKIPPED" : "FAILED",
    issueError: issue.reason,
  });
  return { id: created.id, issueUrl: null };
}

/**
 * 查询作用域对齐唯一约束 (submitterId, clientMutationKey)。
 * 路由层限流前与服务层预检都会调它：同 key 重试命中就不耗限流额度。
 * 带 expected 时校验内容一致：命中行是「上次的提交」而不是「这次的」，
 * 不一致说明客户端拿旧 key 提交了新内容（失败后编辑却没换 key），
 * 直接返回旧反馈会静默丢弃编辑——宁可 409 让客户端换 key 重来。
 */
export async function findFeedbackByMutationKey(
  actor: Actor,
  clientMutationKey: string,
  expected?: { title: string; content: string },
): Promise<SubmitFeedbackResult | null> {
  const existing = await withActorDb(actor, async (tx) =>
    tx.feedback.findFirst({
      where: { submitterId: actor.id, clientMutationKey },
      orderBy: { createdAt: "desc" },
      select: { id: true, issueUrl: true, title: true, content: true },
    }),
  );
  if (!existing) return null;
  if (
    expected &&
    (existing.title !== expected.title || existing.content !== expected.content)
  ) {
    throw new DomainError(
      "FEEDBACK_MUTATION_PAYLOAD_MISMATCH",
      "本次提交与之前的重试内容不一致，请重新提交",
      409,
    );
  }
  return { id: existing.id, issueUrl: existing.issueUrl };
}

/**
 * issue 状态回写失败不致命：反馈落库才是事实源，回写丢一次只是行上
 * 少了同步结果（停在 PENDING），还有结构化日志 + 反馈编号可人工核对；
 * 为它把用户提交打成 500 不值当。
 */
async function writeIssueStatus(
  feedbackId: string,
  data: Prisma.FeedbackUpdateInput,
): Promise<void> {
  try {
    await withSystemDb(async (tx) =>
      tx.feedback.update({ where: { id: feedbackId }, data }),
    );
  } catch (error) {
    console.warn(
      JSON.stringify({
        tag: "FEEDBACK_STATUS_WRITE_FAILED",
        feedbackId,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  }
}

function isPrismaUniqueViolationError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
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
        // createdAt 相同的行用 id 定序，翻页时顺序稳定不闪跳
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
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
