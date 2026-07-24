import type { MailDeliveryMode, Prisma } from "@/generated/prisma/client";

export const MAIL_PROCESSING_CLAIM_STALE_MS = 15 * 60 * 1000;
export const RESEND_MAIL_MAX_ATTEMPTS = 6;

export function mailAttemptBudgetWhere(): Prisma.MailMessageWhereInput {
  return {
    OR: [
      {
        deliveryMode: "RESEND",
        attemptCount: { lt: RESEND_MAIL_MAX_ATTEMPTS },
      },
      {
        deliveryMode: { in: ["SMTP", "LOCAL_OUTBOX"] },
        attemptCount: { lt: 1 },
      },
    ],
  };
}

export function maxMailAttempts(deliveryMode: MailDeliveryMode) {
  return deliveryMode === "RESEND" ? RESEND_MAIL_MAX_ATTEMPTS : 1;
}

export function parseMailJobDeliveryMode(
  value: unknown,
): MailDeliveryMode | null {
  return value === "LOCAL_OUTBOX" || value === "RESEND" || value === "SMTP"
    ? value
    : null;
}

export function buildMailOutboxCandidateWhere(
  now: Date,
): Prisma.MailMessageWhereInput {
  return {
    AND: [
      { contentRiskReviewId: null },
      mailAttemptBudgetWhere(),
      {
        OR: [
          { status: "QUEUED", sendAfter: { lte: now } },
          {
            status: "PROCESSING",
            deliveryMode: { in: ["RESEND", "LOCAL_OUTBOX"] },
            lastAttemptAt: {
              lt: new Date(now.getTime() - MAIL_PROCESSING_CLAIM_STALE_MS),
            },
          },
        ],
      },
    ],
  };
}
