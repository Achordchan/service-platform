"use client";

import { useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  Paper,
  Stack,
  Step,
  StepLabel,
  Stepper,
  TextField,
  Typography,
} from "@mui/material";
import {
  jsonRequest,
  staffApi,
} from "@/components/staff/staff-api";
import type { PlatformSettingsView } from "@/components/staff/platform-settings-types";
import { ResendDnsRecords } from "@/components/staff/resend-dns-records";
import { SmtpFallbackSettings } from "@/components/staff/smtp-fallback-settings";

const modeLabel = {
  LOCAL_OUTBOX: "未启用",
  RESEND: "Resend",
  SMTP: "SMTP",
} as const;

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
  const [apiKey, setApiKey] = useState("");
  const [testEmail, setTestEmail] = useState(currentAdminEmail);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const domainVerified = settings.resendDomainStatus === "verified";
  const webhookReady =
    settings.resendWebhookStatus === "enabled" &&
    settings.hasResendWebhookSecret;
  const resendReady =
    settings.hasResendApiKey && domainVerified && webhookReady;
  const [showConnectionSetup, setShowConnectionSetup] = useState(
    !(
      settings.hasResendApiKey &&
      settings.resendDomainStatus === "verified" &&
      settings.resendWebhookStatus === "enabled" &&
      settings.hasResendWebhookSecret
    ),
  );
  const completedSteps = [
    settings.hasResendApiKey,
    domainVerified,
    webhookReady,
    settings.mailMode === "RESEND",
  ];

  async function run<T>(
    action: string,
    callback: () => Promise<T>,
    message: string,
  ) {
    setBusy(action);
    setError(null);
    setSuccess(null);
    try {
      const result = await callback();
      setSuccess(message);
      return result;
    } catch (actionError) {
      setError(
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
    if (next) {
      onSettingsChange(next);
    }
  }

  async function handleCommonSubmit(
    event: React.FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await saveSettings(
      {
        appUrl: String(form.get("appUrl") ?? "").trim(),
        mailFrom: String(form.get("mailFrom") ?? "").trim(),
        mailReplyTo: String(form.get("mailReplyTo") ?? "").trim(),
      },
      "站点与发件信息已保存",
    );
  }

  async function setupResend() {
    const next = await run(
      "setup",
      () =>
        staffApi<PlatformSettingsView>(
          "/api/v1/admin/mail/resend/setup",
          jsonRequest("POST", apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
        ),
      "Resend 已连接，请配置 DNS",
    );
    if (next) {
      onSettingsChange(next);
      setApiKey("");
    }
  }

  async function disconnectResend() {
    if (
      !window.confirm(
        "确认断开 Resend？如果当前正在使用 Resend，邮件发送将被停用。",
      )
    ) {
      return;
    }
    const next = await run(
      "disconnect",
      () =>
        staffApi<PlatformSettingsView>(
          "/api/v1/admin/mail/resend/setup",
          jsonRequest("DELETE"),
        ),
      "Resend 已断开",
    );
    if (next) {
      onSettingsChange(next);
      setApiKey("");
    }
  }

  async function verifyDomain() {
    const next = await run(
      "verify",
      () =>
        staffApi<PlatformSettingsView>(
          "/api/v1/admin/mail/resend/verify",
          jsonRequest("POST", {}),
        ),
      "域名状态已刷新",
    );
    if (next) onSettingsChange(next);
  }

  async function sendTestMail() {
    await run(
      "test",
      () =>
        staffApi(
          "/api/v1/admin/mail/test",
          jsonRequest("POST", { to: testEmail.trim() }),
        ),
      "测试邮件已加入队列",
    );
  }

  async function copyValue(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setSuccess("DNS 记录值已复制");
    } catch {
      setError("复制失败，请手动选择记录值");
    }
  }

  if (resendReady && !showConnectionSetup) {
    return (
      <Paper
        variant="outlined"
        sx={{
          p: embedded ? 0 : { xs: 2.5, md: 3 },
          border: embedded ? 0 : undefined,
        }}
      >
        <Stack spacing={2.5}>
          {error ? <Alert severity="error">{error}</Alert> : null}
          {success ? <Alert severity="success">{success}</Alert> : null}
          {settings.mailMode === "LOCAL_OUTBOX" ? (
            <Alert severity="warning">
              Resend 已连接但尚未启用，系统不会发送邀请或密码重置邮件。
            </Alert>
          ) : null}
          <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap" }}>
            <Chip label="Resend 已连接" color="success" />
            <Chip label="域名已验证" variant="outlined" />
            <Chip label="Webhook 已启用" variant="outlined" />
          </Stack>
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" },
              gap: 2,
            }}
          >
            {[
              ["发信域名", settings.resendDomain],
              ["发件人", settings.mailFrom],
              ["回复地址", settings.mailReplyTo],
              ["站点地址", settings.appUrl],
            ].map(([label, value]) => (
              <Box key={label} sx={{ minWidth: 0 }}>
                <Typography variant="caption" color="text.secondary">
                  {label}
                </Typography>
                <Typography sx={{ mt: 0.4, overflowWrap: "anywhere" }}>
                  {value}
                </Typography>
              </Box>
            ))}
          </Box>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
            <TextField
              label="测试收件邮箱"
              type="email"
              value={testEmail}
              onChange={(event) => setTestEmail(event.target.value)}
              fullWidth
            />
            <Button
              variant="outlined"
              onClick={sendTestMail}
              disabled={busy !== null || !testEmail.trim()}
              sx={{ whiteSpace: "nowrap" }}
            >
              {busy === "test" ? "发送中" : "发送测试邮件"}
            </Button>
          </Stack>
          <Stack
            direction={{ xs: "column", sm: "row" }}
            spacing={1}
            sx={{ justifyContent: "flex-end" }}
          >
            {settings.mailMode !== "RESEND" ? (
              <Button
                variant="contained"
                onClick={() =>
                  saveSettings({ mailMode: "RESEND" }, "Resend 已启用")
                }
                disabled={busy !== null}
              >
                启用 Resend
              </Button>
            ) : null}
            <Button
              color="inherit"
              onClick={() => setShowConnectionSetup(true)}
              disabled={busy !== null}
            >
              修改连接设置
            </Button>
          </Stack>
        </Stack>
      </Paper>
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
          <Chip
            label={`当前通道：${modeLabel[settings.mailMode]}`}
            color={settings.mailMode === "RESEND" ? "success" : "default"}
            sx={{ alignSelf: "flex-start" }}
          />
          {resendReady ? (
            <Button
              color="inherit"
              onClick={() => setShowConnectionSetup(false)}
            >
              返回概览
            </Button>
          ) : null}
        </Stack>

        {error ? <Alert severity="error">{error}</Alert> : null}
        {success ? <Alert severity="success">{success}</Alert> : null}
        {settings.mailMode === "LOCAL_OUTBOX" ? (
          <Alert severity="warning">
            邮件发送未启用。邀请、密码重置等操作将被阻止，不会进入虚假队列。
          </Alert>
        ) : null}

        <Stack
          key={`common-${settings.updatedAt ?? "initial"}`}
          component="form"
          spacing={2}
          onSubmit={handleCommonSubmit}
        >
          <TextField
            name="appUrl"
            label="站点地址"
            defaultValue={settings.appUrl}
            required
            fullWidth
            helperText="用于邮件链接和 Webhook"
          />
          <TextField
            name="mailFrom"
            label="Resend 发件人"
            defaultValue={settings.mailFrom}
            required
            fullWidth
            slotProps={{ input: { readOnly: true } }}
          />
          <TextField
            name="mailReplyTo"
            label="回复地址"
            type="email"
            defaultValue={settings.mailReplyTo}
            required
            fullWidth
            slotProps={{ input: { readOnly: true } }}
          />
          <Stack direction="row" sx={{ justifyContent: "flex-end" }}>
            <Button type="submit" variant="outlined" disabled={busy !== null}>
              {busy === "save" ? "保存中" : "保存基础设置"}
            </Button>
          </Stack>
        </Stack>

        <Stepper activeStep={-1} alternativeLabel>
          {["连接", "验证域名", "Webhook", "启用"].map(
            (label, index) => (
              <Step key={label} completed={completedSteps[index]}>
                <StepLabel>{label}</StepLabel>
              </Step>
            ),
          )}
        </Stepper>

        <Stack spacing={2}>
          <Typography sx={{ fontWeight: 700 }}>1. 连接 Resend</Typography>
          {!settings.hasDedicatedEncryptionKey ? (
            <Alert severity="warning">
              缺少 PLATFORM_SECRET_ENCRYPTION_KEY，请配置并重启服务。
            </Alert>
          ) : null}
          <TextField
            label="Resend API Key"
            type="password"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            required={!settings.hasResendApiKey}
            helperText={
              settings.hasResendApiKey
                ? "已安全保存；留空不修改"
                : "粘贴 Resend API Key"
            }
            fullWidth
          />
          <Stack
            direction={{ xs: "column", sm: "row" }}
            spacing={1}
            sx={{ justifyContent: "flex-end" }}
          >
            {settings.hasResendApiKey ? (
              <Button
                color="error"
                onClick={disconnectResend}
                disabled={busy !== null}
              >
                {busy === "disconnect" ? "断开中" : "断开 Resend"}
              </Button>
            ) : null}
            <Button
              variant="contained"
              onClick={setupResend}
              disabled={
                busy !== null ||
                !settings.hasDedicatedEncryptionKey ||
                (!settings.hasResendApiKey && !apiKey.trim())
              }
            >
              {busy === "setup"
                ? "连接中"
                : settings.hasResendApiKey
                  ? "刷新 Resend 配置"
                  : "连接 Resend"}
            </Button>
          </Stack>
        </Stack>

        {settings.hasResendApiKey && settings.resendDomainId ? (
          <ResendDnsRecords
            settings={settings}
            busy={busy === "verify"}
            onVerify={verifyDomain}
            onCopy={copyValue}
          />
        ) : null}

        {resendReady ? (
          <Stack spacing={2}>
            <Typography sx={{ fontWeight: 700 }}>4. 测试并启用</Typography>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
              <TextField
                label="测试收件邮箱"
                type="email"
                value={testEmail}
                onChange={(event) => setTestEmail(event.target.value)}
                fullWidth
              />
              <Button
                variant="outlined"
                onClick={sendTestMail}
                disabled={busy !== null || !testEmail.trim()}
                sx={{ whiteSpace: "nowrap" }}
              >
                {busy === "test" ? "发送中" : "发送测试邮件"}
              </Button>
            </Stack>
            <Stack
              direction={{ xs: "column", sm: "row" }}
              spacing={1}
              sx={{ justifyContent: "flex-end" }}
            >
              <Button
                variant="contained"
                onClick={() =>
                  saveSettings({ mailMode: "RESEND" }, "Resend 已启用")
                }
                disabled={busy !== null || settings.mailMode === "RESEND"}
              >
                {settings.mailMode === "RESEND" ? "Resend 已启用" : "启用 Resend"}
              </Button>
            </Stack>
          </Stack>
        ) : null}

        <SmtpFallbackSettings
          settings={settings}
          busy={busy !== null}
          onSave={(payload) =>
            saveSettings(payload, "SMTP 已保存并启用")
          }
        />
      </Stack>
    </Paper>
  );
}
