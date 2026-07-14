import { describe, expect, it } from "vitest";
import {
  planProjectActivity,
  planRequestActivity,
  type ActivityAudience,
} from "../../src/modules/notifications/activity-delivery";

const audience: ActivityAudience = {
  customerUserIds: ["customer-1", "customer-2"],
  projectStaffUserIds: ["manager-1", "tech-1"],
  projectManagerUserIds: ["manager-1"],
  platformAdminUserIds: ["admin-1"],
};

describe("项目活动通知规划", () => {
  it("公开进度动态通知客户和工作人员，但不通知操作者本人", () => {
    const delivery = planProjectActivity({
      actorId: "manager-1",
      audience,
      visibility: "CUSTOMER_VISIBLE",
      eventType: "PROJECT_UPDATE_CREATED",
      eventPayload: {
        projectId: "project-1",
        projectUpdateId: "update-1",
      },
      notificationType: "PROJECT_UPDATE",
      notificationTitle: "项目进度已更新",
      notificationBody: "项目发布了新的进度动态。",
      customerSpaceId: "space-1",
      projectId: "project-1",
    });

    expect(delivery.notifications.map((item) => item.userId)).toEqual([
      "customer-1",
      "customer-2",
      "tech-1",
      "admin-1",
    ]);
    expect(delivery.events).toEqual([
      expect.objectContaining({
        type: "PROJECT_UPDATE_CREATED",
        customerSpaceId: "space-1",
        projectId: "project-1",
      }),
    ]);
  });

  it("内部评论不产生客户通知或客户可见事件", () => {
    const delivery = planProjectActivity({
      actorId: "manager-1",
      audience,
      visibility: "INTERNAL",
      eventType: "UPDATE_COMMENT_CREATED",
      eventPayload: {
        projectId: "project-1",
        projectUpdateId: "update-1",
        updateCommentId: "comment-1",
      },
      notificationType: "UPDATE_COMMENT",
      notificationTitle: "项目动态有新评论",
      notificationBody: "项目进度动态收到了一条新评论。",
      customerSpaceId: "space-1",
      projectId: "project-1",
    });

    expect(delivery.notifications.map((item) => item.userId)).toEqual([
      "tech-1",
      "admin-1",
    ]);
    expect(delivery.events.map((item) => item.userId)).toEqual([
      "manager-1",
      "tech-1",
      "admin-1",
    ]);
    expect(
      delivery.events.every(
        (item) =>
          item.customerSpaceId === "space-1" &&
          item.projectId === "project-1",
      ),
    ).toBe(true);
  });
});

describe("请求活动通知规划", () => {
  it("请求创建不通知未分配技术人员，事件仅按相关用户定向", () => {
    const delivery = planRequestActivity({
      actorId: "customer-1",
      audience,
      relevantWorkerUserIds: [],
      includeCustomers: true,
      eventType: "REQUEST_CREATED",
      eventPayload: {
        projectId: "project-1",
        requestId: "request-1",
        requestNumber: "REQ-1",
      },
      notificationType: "REQUEST_CREATED",
      notificationTitle: "新服务请求 REQ-1",
      notificationBody: "服务请求已创建，等待分配处理人。",
      customerSpaceId: "space-1",
      projectId: "project-1",
      serviceRequestId: "request-1",
    });

    expect(delivery.notifications.map((item) => item.userId)).toEqual([
      "customer-2",
      "manager-1",
      "admin-1",
    ]);
    expect(delivery.events.map((item) => item.userId)).toEqual([
      "customer-1",
      "customer-2",
      "manager-1",
      "admin-1",
    ]);
    expect(
      delivery.events.every(
        (item) =>
          item.projectId === "project-1" &&
          item.serviceRequestId === "request-1" &&
          item.customerSpaceId === "space-1",
      ),
    ).toBe(true);
  });

  it("内部备注只面向项目经理、管理员和当前处理人", () => {
    const delivery = planRequestActivity({
      actorId: "tech-1",
      audience,
      relevantWorkerUserIds: ["tech-1"],
      includeCustomers: false,
      eventType: "REQUEST_MESSAGE_CREATED",
      eventPayload: {
        requestId: "request-1",
        requestNumber: "REQ-1",
        messageId: "message-1",
      },
      notificationType: "REQUEST_MESSAGE",
      notificationTitle: "请求 REQ-1 有新内部备注",
      notificationBody: "服务请求新增了一条内部备注。",
      customerSpaceId: "space-1",
      projectId: "project-1",
      serviceRequestId: "request-1",
    });

    expect(delivery.notifications.map((item) => item.userId)).toEqual([
      "manager-1",
      "admin-1",
    ]);
    expect(delivery.events.map((item) => item.userId)).toEqual([
      "manager-1",
      "admin-1",
      "tech-1",
    ]);
    expect(
      delivery.events.some((item) =>
        JSON.stringify(item.payload).includes("内部备注"),
      ),
    ).toBe(false);
  });
});
