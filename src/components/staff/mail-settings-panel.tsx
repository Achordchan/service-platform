"use client";

import { useState } from "react";
import {
  Alert,
  Chip,
  Divider,
  FormControlLabel,
  Paper,
  Stack,
  Switch,
  Tab,
  Tabs,
  Typography,
} from "@mui/material";
import { jsonRequest, staffApi } from "@/components/staff/staff-api";
import { useToast } from "@/components/shared/toast-provider";
import type { PlatformSettingsView } from "@/components/staff/platform-settings-types";
import { ResendProviderSettings } from "@/components/staff/resend-provider-settings";
import { SmtpSettings } from "@/components/staff/smtp-settings";

const modeLabel = {
  LOCAL_OUTBOX: "未启用",
  RESEND: "Resend",
  SMTP: "SMTP",
} as const;

type ProviderTab = "RESEND" | "SMTP";

export function MailSettingsPanel({
  settings,
  currentAdminEmail,
  onSettingsChange,
  embedded = false,
}: {
  settings: PlatformSettingsView;
  currentAdminEmail: string;
  onSettingsChange: (settings: PlatformSettingsView) => void;
  embedded?: boolean;
}) {
  const toast = useToast();
  const [providerTab, setProviderTab] = useState<ProviderTab>(
    settings.mailMode === "SMTP" ||
      (settings.mailMode === "LOCAL_OUTBOX" &&
        Boolean(settings.smtpHost) &&
        !settings.hasResendApiKey)
      ? "SMTP"
      : "RESEND",
  );
  const [apiKey, setApiKey] = useState("");
  const [testEmail, setTestEmail] = useState(currentAdminEmail);
  const [busy, setBusy] = useState<string | null>(null);
  const domainVerified = settings.resendDomainStatus === "verified";
  const webhookReady =
    settings.resendWebhookStatus === "enabled" &&
    settings.hasResendWebhookSecret;
  const resendReady =
    settings.hasResendApiKey && domainVerified && webhookReady;
  const smtpReady = Boolean(
    settings.smtpHost &&
      settings.smtpPort &&
      settings.smtpUser &&
      settings.hasStoredPassword &&
      settings.smtpFrom &&
      settings.smtpHealthStatus === "healthy",
  );
  const activeMailReady =
    (settings.mailMode === "RESEND" && resendReady) ||
    (settings.mailMode === "SMTP" && smtpReady);
  const [showResendSetup, setShowResendSetup] = useState(!resendReady);

  async function run<T>(
    action: string,
    callback: () => Promise<T>,
    message: string,
  ) {
    setBusy(action);
    try {
      const result = await callback();
      toast.success(message);
      return result;
    } catch (actionError) {
      toast.error(
        actionError instanceof Error
          ? actionError.message
          : "操作失败，请稍后重试",
      );
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function saveSettings(
    payload: Record<string, unknown>,
    message: string,
  ) {
    const next = await run(
      "save",
      () =>
        staffApi<PlatformSettingsView>(
          "/api/v1/admin/settings",
          jsonRequest("PATCH", payload),
        ),
      message,
    );
    if (!next) return false;
    onSettingsChange(next);
    return true;
  }

  async function setupResend() {
    const next = await run(
      "resend-setup",
      () =>
        staffApi<PlatformSettingsView>(
          "/api/v1/admin/mail/resend/setup",
          jsonRequest("POST", apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
        ),
      "Resend 已连接，请完成域名和 Webhook 检查",
    );
    if (next) {
      onSettingsChange(next);
      setApiKey("");
    }
  }

  async function disconnectResend() {
    if (!window.confirm("确认清除 Resend 配置？当前使用 Resend 时会同时停止邮件发送。")) {
      return;
    }
    const next = await run(
      "resend-disconnect",
      () =>
        staffApi<PlatformSettingsView>(
          "/api/v1/admin/mail/resend/setup",
          jsonRequest("DELETE"),
        ),
      "Resend 配置已清除",
    );
    if (next) {
      onSettingsChange(next);
      setApiKey("");
      setShowResendSetup(true);
    }
  }

  async function verifyDomain() {
    const next = await run(
      "resend-verify",
      () =>
        staffApi<PlatformSettingsView>(
          "/api/v1/admin/mail/resend/verify",
          jsonRequest("POST", {}),
        ),
      "Resend 状态已刷新",
    );
    if (next) onSettingsChange(next);
  }

  async function checkSmtp() {
    const next = await run(
      "smtp-check",
      () =>
        staffApi<PlatformSettingsView>(
          "/api/v1/admin/mail/smtp/check",
          jsonRequest("POST", {}),
        ),
      "SMTP 连接检测通过",
    );
    if (next) onSettingsChange(next);
  }

  async function disconnectSmtp() {
    if (!window.confirm("确认清除 SMTP 配置？已保存的密码和连接信息会被删除。")) {
      return;
    }
    const next = await run(
      "smtp-disconnect",
      () =>
        staffApi<PlatformSettingsView>(
          "/api/v1/admin/mail/smtp",
          jsonRequest("DELETE"),
        ),
      "SMTP 配置已清除",
    );
    if (next) onSettingsChange(next);
  }

  async function sendTestMail(deliveryMode: ProviderTab) {
    await run(
      `${deliveryMode.toLowerCase()}-test`,
      () =>
        staffApi(
          "/api/v1/admin/mail/test",
          jsonRequest("POST", {
            to: testEmail.trim(),
            deliveryMode,
          }),
        ),
      `${modeLabel[deliveryMode]} 测试邮件已成功提交给服务商；业务邮件场景和发送时机请在通知规则中配置`,
    );
  }

  return (
    <Paper
      variant="outlined"
      sx={{
        p: embedded ? 0 : { xs: 2.5, md: 3 },
        border: embedded ? 0 : undefined,
      }}
    >
      <Stack spacing={3}>
        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={1}
          sx={{ justifyContent: "space-between", alignItems: { sm: "center" } }}
        >
          <div>
            <Typography sx={{ fontWeight: 700 }}>邮件通道</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.4 }}>
              Resend 与 SMTP 为同级通道，同一时间只会启用其中一个；切换不会删除另一方配置。
            </Typography>
          </div>
          <Chip
            label={`当前通道：${modeLabel[settings.mailMode]}`}
            color={settings.mailMode === "LOCAL_OUTBOX" ? "default" : "success"}
            sx={{ alignSelf: { xs: "flex-start", sm: "center" } }}
          />
        </Stack>

        {settings.mailMode === "LOCAL_OUTBOX" ? (
          <Alert severity="warning">
            当前未启用真实邮件通道，邀请、密码重置和业务提醒不会对外发送。
          </Alert>
        ) : null}
        {activeMailReady ? (
          <Stack
            direction={{ xs: "column", sm: "row" }}
            spacing={1.5}
            sx={{ alignItems: { sm: "center" }, justifyContent: "space-between" }}
          >
            <div>
              <Typography sx={{ fontWeight: 700 }}>邮箱验证码登录</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.4 }}>
                开启后，登录页允许使用 6 位邮箱验证码登录；密码登录仍为默认方式。
              </Typography>
            </div>
            <FormControlLabel
              label={settings.emailOtpLoginEnabled ? "已开启" : "已关闭"}
              labelPlacement="start"
              control={
                <Switch
                  checked={settings.emailOtpLoginEnabled}
                  disabled={busy !== null}
                  onChange={(_, checked) => {
                    void saveSettings(
                      { emailOtpLoginEnabled: checked },
                      checked
                        ? "邮箱验证码登录已开启"
                        : "邮箱验证码登录已关闭",
                    );
                  }}
                />
              }
              sx={{ m: 0, flexShrink: 0 }}
            />
          </Stack>
        ) : null}
        <Divider />

        <Tabs
          value={providerTab}
          onChange={(_, value: ProviderTab) => setProviderTab(value)}
          variant="fullWidth"
          aria-label="邮件通道配置"
        >
          <Tab
            value="RESEND"
            label={`Resend${settings.mailMode === "RESEND" ? " · 已启用" : ""}`}
          />
          <Tab
            value="SMTP"
            label={`SMTP${settings.mailMode === "SMTP" ? " · 已启用" : ""}`}
          />
        </Tabs>

        {providerTab === "RESEND" ? (
          <ResendProviderSettings
            settings={settings}
            apiKey={apiKey}
            testEmail={testEmail}
            busy={busy !== null}
            busyAction={busy}
            showSetup={showResendSetup}
            onApiKeyChange={setApiKey}
            onTestEmailChange={setTestEmail}
            onShowSetupChange={setShowResendSetup}
            onSetup={setupResend}
            onDisconnect={disconnectResend}
            onVerify={verifyDomain}
            onCopy={async (value) => {
              try {
                await navigator.clipboard.writeText(value);
                toast.success("DNS 记录值已复制");
              } catch {
                toast.error("复制失败，请手动选择记录值");
              }
            }}
            onTest={() => sendTestMail("RESEND")}
            onEnable={() =>
              saveSettings(
                { mailMode: "RESEND" },
                "Resend 通道已启用",
              )
            }
          />
        ) : (
          <SmtpSettings
            key={`smtp-${settings.updatedAt ?? "initial"}`}
            settings={settings}
            busy={busy !== null}
            testEmail={testEmail}
            onTestEmailChange={setTestEmail}
            onSave={(payload) =>
              saveSettings(
                payload,
                settings.mailMode === "SMTP"
                  ? "SMTP 配置已保存，邮件已暂停，请重新检测并启用"
                  : "SMTP 配置已保存，请执行连接检测",
              )
            }
            onCheck={checkSmtp}
            onTest={() => sendTestMail("SMTP")}
            onEnable={async () => {
              await saveSettings(
                { mailMode: "SMTP" },
                "SMTP 通道已启用",
              );
            }}
            onDisconnect={disconnectSmtp}
          />
        )}
      </Stack>
    </Paper>
  );
}
