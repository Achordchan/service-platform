import { describe, expect, it } from "vitest";
import {
  describeSmtpError,
  isSmtpProviderFailure,
  smtpSenderPolicyError,
} from "@/modules/platform-settings/smtp-error";

describe("SMTP 错误分类", () => {
  it("返回可操作且不泄露底层错误的提示", () => {
    expect(describeSmtpError({ code: "EAUTH", message: "secret" })).toContain(
      "身份验证失败",
    );
    expect(describeSmtpError({ code: "ETIMEDOUT" })).toContain("无法连接");
    expect(describeSmtpError(new Error("password=secret"))).toBe(
      "SMTP 连接检测失败，请检查服务商设置和授权状态",
    );
    expect(isSmtpProviderFailure({ code: "EAUTH" })).toBe(true);
    expect(isSmtpProviderFailure({ code: "EENVELOPE" })).toBe(false);
    expect(
      describeSmtpError({ code: "EENVELOPE", command: "MAIL FROM" }),
    ).toContain("发件人地址");
    expect(
      describeSmtpError({ code: "EENVELOPE", command: "RCPT TO" }),
    ).toContain("收件人地址");
  });

  it("QQ SMTP 拒绝使用与登录账号不一致的发件邮箱", () => {
    expect(
      smtpSenderPolicyError({
        smtpHost: "smtp.qq.com",
        smtpUser: "service@qq.com",
        smtpFrom: "服务支持中心 <info@achord.cn>",
      }),
    ).toContain("当前 QQ 邮箱");
    expect(
      smtpSenderPolicyError({
        smtpHost: "smtp.qq.com",
        smtpUser: "service@qq.com",
        smtpFrom: "服务支持中心 <service@qq.com>",
      }),
    ).toBeNull();
  });
});
