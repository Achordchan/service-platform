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
        membershipUserIds: ["customer-1"],
      }),
    ).toBe(true);
    expect(
      isStandardProjectRecipientRelevant({
        userId: "staff-1",
        platformRole: "TECHNICIAN",
        membershipUserIds: ["staff-1"],
      }),
    ).toBe(false);
    expect(
      isStandardProjectRecipientRelevant({
        userId: "customer-1",
        platformRole: "CUSTOMER",
        membershipUserIds: [],
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
