import { describe, expect, it } from "vitest";
import {
  canSendStandardProjectEmailForModule,
  isStandardProjectRecipientRelevant,
} from "@/modules/notifications/standard-project-mail-policy";

describe("标准项目交付邮件发送前权限复核", () => {
  it("只允许仍属于客户空间的正式客户接收", () => {
    expect(
      isStandardProjectRecipientRelevant({
        userId: "customer-1",
        platformRole: "CUSTOMER",
        notificationType: "PROJECT_UPDATE",
        membershipUserIds: ["customer-1"],
        projectManagerUserIds: [],
      }),
    ).toBe(true);
    expect(
      isStandardProjectRecipientRelevant({
        userId: "staff-1",
        platformRole: "TECHNICIAN",
        notificationType: "PROJECT_UPDATE",
        membershipUserIds: ["staff-1"],
        projectManagerUserIds: ["staff-1"],
      }),
    ).toBe(false);
    expect(
      isStandardProjectRecipientRelevant({
        userId: "customer-1",
        platformRole: "CUSTOMER",
        notificationType: "PROJECT_UPDATE",
        membershipUserIds: [],
        projectManagerUserIds: [],
      }),
    ).toBe(false);
  });

  it("新建项目允许所选项目负责人和客户成员接收", () => {
    const base = {
      notificationType: "PROJECT_CREATED" as const,
      membershipUserIds: ["customer-1"],
      projectManagerUserIds: ["manager-1"],
    };
    expect(
      isStandardProjectRecipientRelevant({
        ...base,
        userId: "manager-1",
        platformRole: "PROJECT_MANAGER",
      }),
    ).toBe(true);
    expect(
      isStandardProjectRecipientRelevant({
        ...base,
        userId: "customer-1",
        platformRole: "CUSTOMER",
      }),
    ).toBe(true);
    expect(
      isStandardProjectRecipientRelevant({
        ...base,
        userId: "admin-1",
        platformRole: "PLATFORM_ADMIN",
      }),
    ).toBe(false);
  });

  it("客户模块关闭后不再发送对应项目邮件", () => {
    const base = {
      customerUpdatesEnabled: false,
      customerFilesEnabled: false,
      showMilestones: false,
      showProgress: false,
    };
    expect(
      canSendStandardProjectEmailForModule({
        ...base,
        notificationType: "PROJECT_CREATED",
      }),
    ).toBe(true);
    expect(
      canSendStandardProjectEmailForModule({
        ...base,
        notificationType: "PROJECT_UPDATE",
        customerUpdatesEnabled: true,
      }),
    ).toBe(true);
    expect(
      canSendStandardProjectEmailForModule({
        ...base,
        notificationType: "PROJECT_FILE",
      }),
    ).toBe(false);
    expect(
      canSendStandardProjectEmailForModule({
        ...base,
        notificationType: "PROJECT_MILESTONE",
        showProgress: true,
      }),
    ).toBe(true);
  });
});
