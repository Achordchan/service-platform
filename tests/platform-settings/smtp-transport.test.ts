import { describe, expect, it } from "vitest";
import {
  describeSmtpError,
  isSmtpProviderFailure,
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
  });
});
