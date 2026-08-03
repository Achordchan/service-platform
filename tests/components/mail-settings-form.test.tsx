// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { zodResolver } from "@hookform/resolvers/zod";
import { FormProvider, useForm } from "react-hook-form";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ResendProviderSettings } from "@/components/staff/resend-provider-settings";
import {
  mailSettingsFormSchema,
  type MailSettingsFormValues,
} from "@/components/staff/mail-settings-form";
import type { PlatformSettingsView } from "@/components/staff/platform-settings-types";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function settings(overrides: Partial<PlatformSettingsView> = {}): PlatformSettingsView {
  return {
    appUrl: "https://app.example.test",
    mailMode: "LOCAL_OUTBOX",
    mailFrom: "support@example.test",
    hasDedicatedEncryptionKey: true,
    hasResendApiKey: false,
    resendDomain: "example.test",
    resendDomainId: null,
    resendDomainStatus: null,
    resendDnsRecords: [],
    resendWebhookId: null,
    resendWebhookStatus: null,
    hasResendWebhookSecret: false,
    resendLastCheckedAt: null,
    smtpHost: null,
    smtpPort: null,
    smtpUser: null,
    smtpFrom: "",
    smtpSecure: true,
    hasStoredPassword: false,
    smtpHealthStatus: null,
    smtpLastCheckedAt: null,
    smtpLastError: null,
    attachmentMaxSizeMb: 20,
    attachmentAllowedExtensions: "pdf",
    customerReplyAttachmentsEnabled: true,
    standardEmailUnreadDelayEnabled: false,
    emailOtpLoginEnabled: false,
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

function ResendHarness({
  resendSettings,
  showSetup,
  onSetup,
  onTest,
}: {
  resendSettings: PlatformSettingsView;
  showSetup: boolean;
  onSetup: (apiKey: string) => Promise<void>;
  onTest: (email: string) => Promise<void>;
}) {
  const form = useForm<MailSettingsFormValues>({
    resolver: zodResolver(mailSettingsFormSchema),
    defaultValues: { apiKey: "", testEmail: "admin@example.test" },
    mode: "onChange",
  });
  return (
    <FormProvider {...form}>
      <ResendProviderSettings
        settings={resendSettings}
        busy={false}
        busyAction={null}
        showSetup={showSetup}
        onShowSetupChange={vi.fn()}
        onSetup={onSetup}
        onDisconnect={vi.fn().mockResolvedValue(undefined)}
        onVerify={vi.fn().mockResolvedValue(undefined)}
        onCopy={vi.fn().mockResolvedValue(undefined)}
        onTest={onTest}
        onEnable={vi.fn().mockResolvedValue(true)}
      />
    </FormProvider>
  );
}

function renderResend(
  resendSettings: PlatformSettingsView,
  options: {
    showSetup?: boolean;
    onSetup?: (apiKey: string) => Promise<void>;
    onTest?: (email: string) => Promise<void>;
  } = {},
) {
  return render(
    <ResendHarness
      resendSettings={resendSettings}
      showSetup={options.showSetup ?? true}
      onSetup={options.onSetup ?? vi.fn().mockResolvedValue(undefined)}
      onTest={options.onTest ?? vi.fn().mockResolvedValue(undefined)}
    />,
  );
}

describe("邮件设置表单", () => {
  it("Resend API Key 必填并向提交回调传递清洗后的值", async () => {
    const onSetup = vi.fn().mockResolvedValue(undefined);
    renderResend(settings(), { onSetup });

    fireEvent.click(screen.getByRole("button", { name: "连接 Resend" }));
    expect(await screen.findByText("请填写 Resend API Key")).toBeTruthy();
    expect(onSetup).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText(/Resend API Key/), {
      target: { value: "  re_test_key  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "连接 Resend" }));

    await waitFor(() => expect(onSetup).toHaveBeenCalledWith("re_test_key"));
  });

  it("测试邮箱通过同一表单上下文校验并传递给发送回调", async () => {
    const onTest = vi.fn().mockResolvedValue(undefined);
    renderResend(
      settings({
        mailMode: "RESEND",
        hasResendApiKey: true,
        resendDomainStatus: "verified",
        resendWebhookStatus: "enabled",
        hasResendWebhookSecret: true,
      }),
      { showSetup: false, onTest },
    );

    fireEvent.change(screen.getByLabelText("测试收件邮箱"), {
      target: { value: "not-an-email" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送 Resend 测试邮件" }));
    expect(onTest).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("测试收件邮箱"), {
      target: { value: "  qa@example.test  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送 Resend 测试邮件" }));
    await waitFor(() => expect(onTest).toHaveBeenCalledWith("qa@example.test"));
  });
});
