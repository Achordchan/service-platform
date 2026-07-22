import { describe, expect, it } from "vitest";
import { notificationEmailDueAt } from "@/modules/notifications/notification-email-timing";

describe("notificationEmailDueAt", () => {
  const now = new Date("2026-07-22T08:00:00.000Z");

  it("关闭未读延迟时立即到期", () => {
    expect(notificationEmailDueAt(false, now)).toEqual(now);
  });

  it("开启未读延迟时延后五分钟", () => {
    expect(notificationEmailDueAt(true, now)).toEqual(
      new Date("2026-07-22T08:05:00.000Z"),
    );
  });
});
