import { describe, expect, it } from "vitest";
import {
  formatSmtpSender,
  mailboxFromSender,
  smtpSenderName,
} from "@/modules/platform-settings/smtp-sender";

describe("SMTP 发件人格式", () => {
  it("只提取可编辑的显示名称", () => {
    expect(smtpSenderName("客户服务 <service@example.com>")).toBe("客户服务");
    expect(smtpSenderName("service@example.com")).toBe("服务支持中心");
  });

  it("始终使用 SMTP 登录邮箱并清理控制字符", () => {
    expect(formatSmtpSender("客户\n服务 <伪造>", " service@example.com ")).toBe(
      "客户 服务 伪造 <service@example.com>",
    );
  });

  it("从发件人格式中提取实际回复邮箱", () => {
    expect(mailboxFromSender("服务支持中心 <sender@example.com>")).toBe(
      "sender@example.com",
    );
    expect(mailboxFromSender("sender@example.com")).toBe(
      "sender@example.com",
    );
    expect(mailboxFromSender("不是邮箱")).toBeNull();
  });
});
