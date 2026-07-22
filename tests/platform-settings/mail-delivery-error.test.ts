import { describe, expect, it } from "vitest";
import {
  describeMailDeliveryFailure,
  describeMailQueueFailure,
  formatMailFailureMessage,
  MailDeliveryError,
} from "@/modules/platform-settings/mail-delivery-error";

describe("邮件投递错误诊断", () => {
  it("SMTP 错误保留可操作代码但不泄露底层信息", () => {
    const failure = describeMailDeliveryFailure("SMTP", {
      code: "EAUTH",
      message: "password=do-not-log",
    });

    expect(failure).toMatchObject({
      category: "SMTP_DELIVERY",
      code: "EAUTH",
    });
    expect(failure.message).toContain("身份验证失败");
    expect(failure.message).toContain("EAUTH");
    expect(failure.message).not.toContain("do-not-log");
  });

  it("Resend 仅返回受控的诊断信息", () => {
    const failure = describeMailDeliveryFailure("RESEND", {
      code: "validation_error",
      message: "api_key=do-not-log",
    });

    expect(failure).toMatchObject({
      category: "RESEND_DELIVERY",
      code: "validation_error",
    });
    expect(failure.message).not.toContain("do-not-log");
  });

  it("保留已脱敏的业务错误", () => {
    const expected = {
      category: "SMTP_CONFIGURATION" as const,
      message: "SMTP 未配置完整：缺少用户名或密码",
    };
    const error = new MailDeliveryError(expected);

    expect(describeMailDeliveryFailure("SMTP", error)).toEqual(expected);
  });

  it("任务队列错误保留可操作代码但不泄露底层信息", () => {
    const failure = describeMailQueueFailure({
      code: "ECONNREFUSED",
      message: "postgresql://user:password@private-host:5432/jobs",
    });

    expect(failure).toMatchObject({
      category: "MAIL_QUEUE",
      code: "ECONNREFUSED",
    });
    expect(failure.message).toContain("无法连接邮件任务队列");
    expect(failure.message).not.toContain("password");
    expect(formatMailFailureMessage(failure.message, "mail_abc")).toContain(
      "错误编号：mail_abc",
    );
  });
});
