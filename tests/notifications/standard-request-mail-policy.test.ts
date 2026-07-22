import { describe, expect, it } from "vitest";
import {
  canSendStandardRequestEmailForModule,
  isCurrentMailRecipient,
  isStandardRequestRecipientRelevant,
} from "@/modules/notifications/standard-request-mail-policy";

describe("标准工单邮件发送前权限复核", () => {
  it("平台管理员始终有效，客户必须仍在空间内", () => {
    expect(
      isStandardRequestRecipientRelevant({
        userId: "admin-1",
        platformRole: "PLATFORM_ADMIN",
        membershipUserIds: [],
        projectStaffUserIds: [],
        assigneeUserIds: [],
      }),
    ).toBe(true);
    expect(
      isStandardRequestRecipientRelevant({
        userId: "customer-1",
        platformRole: "CUSTOMER",
        membershipUserIds: [],
        projectStaffUserIds: [],
        assigneeUserIds: [],
      }),
    ).toBe(false);
  });

  it("后台人员必须仍是项目成员或当前处理人", () => {
    expect(
      isStandardRequestRecipientRelevant({
        userId: "tech-1",
        platformRole: "TECHNICIAN",
        membershipUserIds: [],
        projectStaffUserIds: ["tech-1"],
        assigneeUserIds: [],
      }),
    ).toBe(true);
    expect(
      isStandardRequestRecipientRelevant({
        userId: "tech-1",
        platformRole: "TECHNICIAN",
        membershipUserIds: [],
        projectStaffUserIds: [],
        assigneeUserIds: [],
      }),
    ).toBe(false);
  });

  it("客户工单模块关闭只抑制客户邮件，不抑制后台人员邮件", () => {
    expect(
      canSendStandardRequestEmailForModule({
        platformRole: "CUSTOMER",
        customerRequestsEnabled: false,
      }),
    ).toBe(false);
    expect(
      canSendStandardRequestEmailForModule({
        platformRole: "TECHNICIAN",
        customerRequestsEnabled: false,
      }),
    ).toBe(true);
    expect(
      canSendStandardRequestEmailForModule({
        platformRole: "PLATFORM_ADMIN",
        customerRequestsEnabled: false,
      }),
    ).toBe(true);
  });

  it("发送前必须与用户当前邮箱完全匹配", () => {
    expect(isCurrentMailRecipient(" Client@Example.com ", "client@example.com"))
      .toBe(true);
    expect(isCurrentMailRecipient("old@example.com", "new@example.com"))
      .toBe(false);
  });
});
