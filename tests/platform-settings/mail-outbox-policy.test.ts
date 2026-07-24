import { describe, expect, it } from "vitest";
import {
  buildMailOutboxCandidateWhere,
  MAIL_PROCESSING_CLAIM_STALE_MS,
  mailAttemptBudgetWhere,
  maxMailAttempts,
  parseMailJobDeliveryMode,
  RESEND_MAIL_MAX_ATTEMPTS,
} from "@/lib/mail-outbox-policy";

describe("邮件 Outbox 补投策略", () => {
  it("同时扫描到期队列和超过声明时限的处理中邮件", () => {
    const now = new Date("2026-07-21T12:00:00.000Z");

    expect(buildMailOutboxCandidateWhere(now)).toEqual({
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
    });
  });

  it("按数据库总尝试次数限制真实发信重试", () => {
    expect(RESEND_MAIL_MAX_ATTEMPTS).toBe(6);
    expect(maxMailAttempts("RESEND")).toBe(6);
    expect(maxMailAttempts("SMTP")).toBe(1);
    expect(maxMailAttempts("LOCAL_OUTBOX")).toBe(1);
  });

  it("拒绝没有通道版本的历史任务，交由 Outbox 重新补投", () => {
    expect(parseMailJobDeliveryMode(undefined)).toBeNull();
    expect(parseMailJobDeliveryMode("legacy")).toBeNull();
    expect(parseMailJobDeliveryMode("SMTP")).toBe("SMTP");
    expect(parseMailJobDeliveryMode("RESEND")).toBe("RESEND");
  });
});
