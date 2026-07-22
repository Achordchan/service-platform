import { describe, expect, it } from "vitest";
import type { RuntimeMailSettings } from "../../src/modules/platform-settings/mail-settings-runtime";
import { assertDeliveryModeReady } from "../../src/modules/platform-settings/mail-delivery-readiness";

const readySettings: RuntimeMailSettings = {
  appUrl: "https://support.achord.cn",
  mailMode: "RESEND",
  mailFrom: "服务支持中心 <no-reply@mail.achord.cn>",
  resendApiKeyEncrypted: "encrypted",
  resendDomain: "mail.achord.cn",
  resendDomainId: "domain-id",
  resendDomainStatus: "verified",
  resendWebhookId: "webhook-id",
  resendWebhookStatus: "enabled",
  hasResendWebhookSecret: true,
  smtpHost: "smtp.example.com",
  smtpPort: 465,
  smtpUser: "mailer",
  smtpPassword: "secret",
  smtpFrom: "服务支持中心 <mailer@example.com>",
  smtpSecure: true,
  hasStoredPassword: true,
  smtpHealthStatus: "healthy",
  smtpLastCheckedAt: new Date(),
  smtpLastError: null,
  standardEmailUnreadDelayEnabled: false,
};

describe("mail delivery readiness", () => {
  it("blocks local outbox in production", () => {
    expect(() =>
      assertDeliveryModeReady(readySettings, "LOCAL_OUTBOX", true),
    ).toThrow("邮件服务尚未启用");
  });

  it("keeps local outbox available for development previews", () => {
    expect(() =>
      assertDeliveryModeReady(readySettings, "LOCAL_OUTBOX", false),
    ).not.toThrow();
  });

  it("requires complete Resend configuration", () => {
    expect(() =>
      assertDeliveryModeReady(
        { ...readySettings, resendWebhookStatus: "missing" },
        "RESEND",
        true,
      ),
    ).toThrow("Resend 尚未完成");
  });

  it("requires complete SMTP credentials", () => {
    expect(() =>
      assertDeliveryModeReady(
        { ...readySettings, smtpPassword: null },
        "SMTP",
        true,
      ),
    ).toThrow("SMTP 配置不完整");
  });

  it("requires SMTP connection check before delivery", () => {
    expect(() =>
      assertDeliveryModeReady(
        { ...readySettings, smtpHealthStatus: "unchecked" },
        "SMTP",
        true,
      ),
    ).toThrow("尚未通过连接检测");
  });
});
