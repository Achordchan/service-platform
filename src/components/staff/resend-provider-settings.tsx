"use client";

import { Controller, useFormContext, useWatch } from "react-hook-form";
import {
  Alert,
  Box,
  Button,
  Chip,
  Stack,
  Step,
  StepLabel,
  Stepper,
  TextField,
  Typography,
} from "@mui/material";
import type { PlatformSettingsView } from "@/components/staff/platform-settings-types";
import { ResendDnsRecords } from "@/components/staff/resend-dns-records";
import type { MailSettingsFormValues } from "@/components/staff/mail-settings-form";

export function ResendProviderSettings({
  settings,
  busy,
  busyAction,
  showSetup,
  onShowSetupChange,
  onSetup,
  onDisconnect,
  onVerify,
  onCopy,
  onTest,
  onEnable,
}: {
  settings: PlatformSettingsView;
  busy: boolean;
  busyAction: string | null;
  showSetup: boolean;
  onShowSetupChange: (show: boolean) => void;
  onSetup: (apiKey: string) => Promise<void>;
  onDisconnect: () => Promise<void>;
  onVerify: () => Promise<void>;
  onCopy: (value: string) => Promise<void>;
  onTest: (testEmail: string) => Promise<void>;
  onEnable: () => Promise<boolean>;
}) {
  const form = useFormContext<MailSettingsFormValues>();
  const domainVerified = settings.resendDomainStatus === "verified";
  const webhookReady =
    settings.resendWebhookStatus === "enabled" &&
    settings.hasResendWebhookSecret;
  const ready = settings.hasResendApiKey && domainVerified && webhookReady;
  const completedSteps = [
    settings.hasResendApiKey,
    domainVerified,
    webhookReady,
    settings.mailMode === "RESEND",
  ];

  if (ready && !showSetup) {
    return (
      <ResendOverview
        settings={settings}
        busy={busy}
        onTest={onTest}
        onEnable={onEnable}
        onEdit={() => onShowSetupChange(true)}
      />
    );
  }

  async function submitSetup() {
    const valid = await form.trigger("apiKey");
    if (!valid) return;
    const apiKey = form.getValues("apiKey");
    if (!settings.hasResendApiKey && !apiKey.trim()) {
      form.setError("apiKey", { message: "请填写 Resend API Key" });
      return;
    }
    await onSetup(apiKey.trim());
  }

  return (
    <Stack spacing={2.5}>
      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={1}
        sx={{ justifyContent: "space-between", alignItems: { sm: "center" } }}
      >
        <Stepper activeStep={-1} alternativeLabel sx={{ flex: 1 }}>
          {["连接", "验证域名", "Webhook", "启用"].map((label, index) => (
            <Step key={label} completed={completedSteps[index]}>
              <StepLabel>{label}</StepLabel>
            </Step>
          ))}
        </Stepper>
        {ready ? (
          <Button onClick={() => onShowSetupChange(false)}>返回概览</Button>
        ) : null}
      </Stack>

      {!settings.hasDedicatedEncryptionKey ? (
        <Alert severity="warning">
          缺少 PLATFORM_SECRET_ENCRYPTION_KEY，不能从后台安全保存 Resend API Key。
        </Alert>
      ) : null}
      <Controller
        name="apiKey"
        control={form.control}
        render={({ field, fieldState }) => (
          <TextField
            {...field}
            label="Resend API Key"
            type="password"
            required={!settings.hasResendApiKey}
            error={Boolean(fieldState.error)}
            helperText={
              fieldState.error?.message ??
              (settings.hasResendApiKey
                ? "已加密保存；留空表示不修改"
                : "粘贴 Resend API Key")
            }
            fullWidth
          />
        )}
      />
      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={1}
        sx={{ justifyContent: "flex-end" }}
      >
        {settings.hasResendApiKey ? (
          <Button
            color="error"
            onClick={() => void onDisconnect()}
            disabled={busy}
          >
            清除 Resend 配置
          </Button>
        ) : null}
        <Button
          variant="contained"
          onClick={() => void submitSetup()}
          disabled={
            busy ||
            !settings.hasDedicatedEncryptionKey
          }
        >
          {busyAction === "resend-setup"
            ? "连接中"
            : settings.hasResendApiKey
              ? "刷新 Resend 配置"
              : "连接 Resend"}
        </Button>
      </Stack>

      {settings.hasResendApiKey && settings.resendDomainId ? (
        <ResendDnsRecords
          settings={settings}
          busy={busyAction === "resend-verify"}
          onVerify={onVerify}
          onCopy={onCopy}
        />
      ) : null}

      {ready ? (
        <ResendOverview
          settings={settings}
          busy={busy}
          onTest={onTest}
          onEnable={onEnable}
          compact
        />
      ) : null}
    </Stack>
  );
}

function ResendOverview({
  settings,
  busy,
  onTest,
  onEnable,
  onEdit,
  compact = false,
}: {
  settings: PlatformSettingsView;
  busy: boolean;
  onTest: (testEmail: string) => Promise<void>;
  onEnable: () => Promise<boolean>;
  onEdit?: () => void;
  compact?: boolean;
}) {
  const form = useFormContext<MailSettingsFormValues>();
  const testEmail = useWatch({ control: form.control, name: "testEmail" });

  async function submitTest() {
    const valid = await form.trigger("testEmail");
    if (!valid) return;
    await onTest(testEmail.trim());
  }

  return (
    <Stack spacing={2.25}>
      <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap" }}>
        <Chip label="Resend 已连接" color="success" />
        <Chip label="域名已验证" variant="outlined" />
        <Chip label="Webhook 已启用" variant="outlined" />
        {settings.mailMode === "RESEND" ? (
          <Chip label="当前启用" color="success" variant="outlined" />
        ) : null}
      </Stack>
      {!compact ? (
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
      ) : null}
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr", sm: "minmax(0, 1fr) auto" },
          gap: 1.5,
          alignItems: "center",
        }}
      >
        <Controller
          name="testEmail"
          control={form.control}
          render={({ field, fieldState }) => (
            <TextField
              {...field}
              label="测试收件邮箱"
              type="email"
              error={Boolean(fieldState.error)}
              helperText={fieldState.error?.message}
              fullWidth
            />
          )}
        />
        <Button
          variant="outlined"
          onClick={() => void submitTest()}
          disabled={busy || !testEmail.trim()}
          sx={{ whiteSpace: "nowrap" }}
        >
          发送 Resend 测试邮件
        </Button>
      </Box>
      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={1}
        sx={{ justifyContent: "flex-end" }}
      >
        {onEdit ? <Button onClick={onEdit}>修改连接设置</Button> : null}
        <Button
          variant="contained"
          onClick={() => void onEnable()}
          disabled={busy || settings.mailMode === "RESEND"}
        >
          {settings.mailMode === "RESEND"
            ? "Resend 已启用"
            : "启用 Resend"}
        </Button>
      </Stack>
    </Stack>
  );
}
