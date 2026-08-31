import "server-only";

import type {
  ContentRiskTargetType,
  Prisma,
} from "@/generated/prisma/client";
import { withSystemDb } from "@/lib/system-db";
import { contentReeditExpiresAt } from "@/lib/content-reedit-window";
import { isContentRiskPublicUiEnabled } from "@/modules/plugins/content-risk-service";

export type ContentRiskViewState = {
  displayState: "VISIBLE" | "REVOKED";
  reviewStatus:
    | "QUEUED"
    | "PROCESSING"
    | "PASSED"
    | "VIOLATION"
    | "UNCERTAIN"
    | "SKIPPED_UNSUPPORTED"
    | "CANCELLED"
    | "FAILED"
    | null;
  reviewSource: "RULE" | "AI" | "ADMIN" | null;
  decisionReason: string | null;
  /** 撤回时刻；「重新编辑」时限从这里起算（见 content-reedit-window） */
  revokedAt: Date | null;
};

export type PublicContentRiskStatus = "PENDING" | "REVOKED" | null;

export async function loadContentRiskPageState(
  targets: Array<{ targetType: ContentRiskTargetType; targetId: string }>,
  existingTx?: Prisma.TransactionClient,
) {
  const load = async (tx: Prisma.TransactionClient) => {
    const enabled = await isContentRiskPublicUiEnabled(tx);
    const uniqueTargets = [
      ...new Map(
        targets.map((target) => [
          `${target.targetType}:${target.targetId}`,
          target,
        ]),
      ).values(),
    ];
    const states = uniqueTargets.length
      ? await tx.contentRiskState.findMany({
          where: {
            OR: uniqueTargets.map((target) => ({
              targetType: target.targetType,
              targetId: target.targetId,
            })),
          },
        })
      : [];
    const reviewIds = states.flatMap((state) =>
      state.latestReviewId ? [state.latestReviewId] : [],
    );
    const reviews = reviewIds.length
      ? await tx.contentRiskReview.findMany({
          where: { id: { in: reviewIds } },
          select: {
            id: true,
            status: true,
            source: true,
            decisionReason: true,
          },
        })
      : [];
    const reviewById = new Map(reviews.map((review) => [review.id, review]));
    return {
      enabled,
      states: new Map(
        states.map((state) => [
          `${state.targetType}:${state.targetId}`,
          {
            displayState: state.displayState,
            reviewStatus: state.latestReviewId
              ? reviewById.get(state.latestReviewId)?.status ?? null
              : null,
            reviewSource: state.latestReviewId
              ? reviewById.get(state.latestReviewId)?.source ?? null
              : null,
            decisionReason: state.latestReviewId
              ? reviewById.get(state.latestReviewId)?.decisionReason ?? null
              : null,
            revokedAt: state.revokedAt,
          } satisfies ContentRiskViewState,
        ]),
      ),
    };
  };
  return existingTx ? load(existingTx) : withSystemDb(load);
}

/**
 * 撤回内容还能不能由作者「重新编辑」，返回截止时刻（不能则 null）。
 *
 * 两道闸：管理员人工撤回的一律不给 —— 那是带理由的人工裁决，让作者一键把原话
 * 送回输入框重发，等于裁决可以被单方面绕过（企业微信同样规定：管理员撤回的消息
 * 发送者不能重新编辑，只有自己撤回的才可以）。AI/规则撤回则按时限放行，重发的
 * 内容还会再走一遍风控。
 */
export function contentReeditDeadlineFor(
  state: ContentRiskViewState | undefined,
  nowMs: number = Date.now(),
): Date | null {
  if (state?.displayState !== "REVOKED") return null;
  if (state.reviewSource === "ADMIN") return null;
  const expiresAt = contentReeditExpiresAt(state.revokedAt);
  return expiresAt !== null && expiresAt.getTime() > nowMs ? expiresAt : null;
}

export function contentRiskReasonFor(
  state: ContentRiskViewState | undefined,
) {
  if (
    state?.displayState !== "REVOKED" ||
    state.reviewSource !== "ADMIN"
  ) {
    return null;
  }
  return state.decisionReason?.trim() || null;
}

export function isContentRiskStateRevoked(
  state: ContentRiskViewState | undefined,
) {
  return state?.displayState === "REVOKED";
}

export function contentRiskStatusFor(
  state: ContentRiskViewState | undefined,
  options: { pluginEnabled: boolean; showPending: boolean },
): PublicContentRiskStatus {
  if (state?.displayState === "REVOKED") return "REVOKED";
  if (
    options.pluginEnabled &&
    options.showPending &&
    (state?.reviewStatus === "QUEUED" || state?.reviewStatus === "PROCESSING")
  ) {
    return "PENDING";
  }
  return null;
}
