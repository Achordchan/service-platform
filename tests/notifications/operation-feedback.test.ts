import { describe, expect, it } from "vitest";
import { deliveryFeedbackMessage } from "@/lib/operation-feedback";

describe("deliveryFeedbackMessage", () => {
  it("returns no message when the operation created no delivery work", () => {
    expect(
      deliveryFeedbackMessage({
        notificationCount: 0,
        emailCount: 0,
        emailTiming: null,
        dingtalkQueued: false,
      }),
    ).toBeNull();
  });

  it("describes immediate mail and DingTalk as queued instead of delivered", () => {
    expect(
      deliveryFeedbackMessage({
        notificationCount: 2,
        emailCount: 1,
        emailTiming: "IMMEDIATE",
        dingtalkQueued: true,
      }),
    ).toBe(
      "通知已安排：站内通知 2 人；邮件 1 封已进入发送队列；钉钉机器人消息已进入发送队列",
    );
  });

  it("explains the unread delay when delayed mail is enabled", () => {
    expect(
      deliveryFeedbackMessage({
        notificationCount: 1,
        emailCount: 1,
        emailTiming: "DELAYED",
        dingtalkQueued: false,
      }),
    ).toContain("邮件 1 封将在持续未读 5 分钟后发送");
  });

  it("uses a concise notification summary for customer-facing operations", () => {
    expect(
      deliveryFeedbackMessage(
        {
          notificationCount: 2,
          emailCount: 2,
          emailTiming: "IMMEDIATE",
          dingtalkQueued: true,
        },
        "summary",
      ),
    ).toBe("相关人员将收到通知");
  });
});
