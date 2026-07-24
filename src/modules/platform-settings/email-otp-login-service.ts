import "server-only";

import { getRuntimeMailSettings } from "@/modules/platform-settings/mail-settings-runtime";
import { assertDeliveryModeReady } from "@/modules/platform-settings/mail-delivery-readiness";
import { DomainError } from "@/modules/projects/errors";

export async function assertEmailOtpLoginAvailable() {
  const settings = await getRuntimeMailSettings();
  if (!settings.emailOtpLoginEnabled) {
    throw new DomainError(
      "EMAIL_OTP_LOGIN_DISABLED",
      "管理员尚未开启邮箱验证码登录",
      409,
    );
  }
  if (settings.mailMode === "LOCAL_OUTBOX") {
    throw new DomainError(
      "EMAIL_OTP_LOGIN_DISABLED",
      "邮箱验证码登录需要先启用 SMTP 或 Resend",
      409,
    );
  }
  assertDeliveryModeReady(settings, settings.mailMode, true);
  return settings.mailMode;
}

export async function isEmailOtpLoginAvailable() {
  try {
    await assertEmailOtpLoginAvailable();
    return true;
  } catch {
    return false;
  }
}
