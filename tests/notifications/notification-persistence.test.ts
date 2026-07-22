import { describe, expect, it } from "vitest";
import { toNotificationPersistenceInput } from "@/modules/notifications/notification-persistence";

describe("通知持久化输入", () => {
  it("不会把仅用于投递判断的邮件候选标记写入数据库", () => {
    const input = toNotificationPersistenceInput(
      {
        type: "REQUEST_MESSAGE",
        title: "请求有新回复",
        body: "回复摘要",
        userId: "customer-1",
        customerSpaceId: "space-1",
        projectId: "project-1",
        serviceRequestId: "request-1",
        aggregationKey: "request:request-1:REQUEST_MESSAGE:mail",
        emailEligible: true,
      },
      new Date("2026-07-22T00:05:00.000Z"),
    );

    expect(input).toEqual({
      type: "REQUEST_MESSAGE",
      title: "请求有新回复",
      body: "回复摘要",
      userId: "customer-1",
      customerSpaceId: "space-1",
      projectId: "project-1",
      serviceRequestId: "request-1",
      aggregationKey: "request:request-1:REQUEST_MESSAGE:mail",
      emailDueAt: new Date("2026-07-22T00:05:00.000Z"),
    });
    expect(input).not.toHaveProperty("emailEligible");
  });
});
