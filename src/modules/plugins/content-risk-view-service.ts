import "server-only";

import type {
  ContentRiskTargetType,
  Prisma,
} from "@/generated/prisma/client";
import { withSystemDb } from "@/lib/system-db";
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
