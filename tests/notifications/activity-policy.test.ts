import { describe, expect, it } from "vitest";
import {
  isCustomerStatusEmailEligible,
  isProjectChangeAudible,
  isProjectDeliveryNotification,
  isRequestChangeAudible,
  isRequestNotification,
  planStandardRequestEmailRecipientIds,
  planDingTalkRequestEvent,
} from "@/modules/notifications/activity-policy";

describe("统一活动投递策略", () => {
  it("覆盖新增的项目与服务请求红点类型", () => {
    expect(isProjectDeliveryNotification("PROJECT_CREATED")).toBe(true);
    expect(isProjectDeliveryNotification("PROJECT_STAGE")).toBe(true);
    expect(isProjectDeliveryNotification("PROJECT_MILESTONE")).toBe(true);
    expect(isProjectDeliveryNotification("PROJECT_FILE")).toBe(true);
    expect(isRequestNotification("REQUEST_ATTACHMENT")).toBe(true);
    expect(isRequestNotification("REQUEST_ARCHIVE")).toBe(true);
    expect(isRequestNotification("REQUEST_CLAIMED")).toBe(true);
  });

  it("技术处理和权限配置事件保持静音", () => {
    expect(isProjectChangeAudible("PROJECT_UPDATED")).toBe(false);
    expect(isProjectChangeAudible("PROJECT_UPDATE_DELETED")).toBe(false);
    expect(isProjectChangeAudible("ATTACHMENT_OPTIMIZED")).toBe(false);
    expect(isRequestChangeAudible("ATTACHMENT_OPTIMIZED")).toBe(false);
    expect(isRequestChangeAudible("REQUEST_MESSAGE_CREATED")).toBe(true);
  });

  it("只有面向客户的手动状态才具备标准邮件资格", () => {
    expect(isCustomerStatusEmailEligible("WAITING_CUSTOMER")).toBe(true);
    expect(isCustomerStatusEmailEligible("RESOLVED")).toBe(true);
    expect(isCustomerStatusEmailEligible("CLOSED")).toBe(true);
    expect(isCustomerStatusEmailEligible("PENDING")).toBe(false);
    expect(isCustomerStatusEmailEligible("IN_PROGRESS")).toBe(false);
  });

  it("按责任关系规划标准服务请求邮件收件人", () => {
    const base = {
      actorId: "customer-1",
      actorPlatformRole: "CUSTOMER",
      includeCustomers: true,
      customerUserIds: ["customer-1", "customer-2"],
      projectManagerUserIds: ["manager-1"],
      platformAdminUserIds: ["admin-1"],
      relevantWorkerUserIds: ["tech-1"],
      emailWorkerUserIds: ["tech-2"],
    };
    expect(
      planStandardRequestEmailRecipientIds({
        ...base,
        eventType: "REQUEST_CREATED",
      }),
    ).toEqual(["manager-1", "admin-1"]);
    expect(
      planStandardRequestEmailRecipientIds({
        ...base,
        eventType: "REQUEST_MESSAGE_CREATED",
        visibility: "CUSTOMER_VISIBLE",
      }),
    ).toEqual(["tech-1", "admin-1"]);
    expect(
      planStandardRequestEmailRecipientIds({
        ...base,
        relevantWorkerUserIds: [],
        eventType: "REQUEST_MESSAGE_CREATED",
        visibility: "CUSTOMER_VISIBLE",
      }),
    ).toEqual(["manager-1", "admin-1"]);
    expect(
      planStandardRequestEmailRecipientIds({
        ...base,
        actorId: "manager-1",
        actorPlatformRole: "PROJECT_MANAGER",
        eventType: "REQUEST_MESSAGE_CREATED",
        visibility: "CUSTOMER_VISIBLE",
      }),
    ).toEqual(["customer-1", "customer-2"]);
    expect(
      planStandardRequestEmailRecipientIds({
        ...base,
        eventType: "REQUEST_ASSIGNED",
      }),
    ).toEqual(["tech-2"]);
    expect(
      planStandardRequestEmailRecipientIds({
        ...base,
        actorId: "manager-1",
        actorPlatformRole: "PROJECT_MANAGER",
        eventType: "REQUEST_ASSIGNED",
        notificationType: "REQUEST_CLAIMED",
      }),
    ).toEqual(["admin-1"]);
  });

  it("内部备注、自动处理中状态和客户关闭动作不产生标准邮件", () => {
    const base = {
      actorId: "manager-1",
      actorPlatformRole: "PROJECT_MANAGER",
      includeCustomers: true,
      customerUserIds: ["customer-1"],
      projectManagerUserIds: ["manager-1"],
      platformAdminUserIds: ["admin-1"],
      relevantWorkerUserIds: ["tech-1"],
    };
    expect(
      planStandardRequestEmailRecipientIds({
        ...base,
        eventType: "REQUEST_MESSAGE_CREATED",
        visibility: "INTERNAL",
      }),
    ).toEqual([]);
    expect(
      planStandardRequestEmailRecipientIds({
        ...base,
        eventType: "REQUEST_STATUS_CHANGED",
        status: "IN_PROGRESS",
      }),
    ).toEqual([]);
    expect(
      planStandardRequestEmailRecipientIds({
        ...base,
        actorId: "customer-1",
        actorPlatformRole: "CUSTOMER",
        eventType: "REQUEST_STATUS_CHANGED",
        status: "CLOSED",
      }),
    ).toEqual([]);
  });

  it("钉钉只规划新工单和客户公开回复", () => {
    const base = {
      enabled: true,
      requestId: "request-1",
      actorName: "测试用户",
      customerActor: true,
    };
    expect(
      planDingTalkRequestEvent({
        ...base,
        eventType: "REQUEST_CREATED",
      }),
    ).toMatchObject({
      eventKey: "request-created:request-1",
      eventType: "REQUEST_CREATED",
    });
    expect(
      planDingTalkRequestEvent({
        ...base,
        eventType: "REQUEST_MESSAGE_CREATED",
        messageId: "message-1",
        visibility: "CUSTOMER_VISIBLE",
        contentSummary: "客户补充了错误截图",
      }),
    ).toMatchObject({
      eventKey: "customer-replied:message-1",
      eventType: "REQUEST_CUSTOMER_REPLIED",
      contentSummary: "客户补充了错误截图",
    });
    expect(
      planDingTalkRequestEvent({
        ...base,
        customerActor: false,
        eventType: "REQUEST_MESSAGE_CREATED",
        messageId: "message-1",
        visibility: "CUSTOMER_VISIBLE",
      }),
    ).toBeNull();
    expect(
      planDingTalkRequestEvent({
        ...base,
        enabled: false,
        eventType: "REQUEST_CREATED",
      }),
    ).toBeNull();
  });
});
