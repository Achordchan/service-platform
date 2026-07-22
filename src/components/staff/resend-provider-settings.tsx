"use client";

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

export function ResendProviderSettings({
  settings,
  apiKey,
  testEmail,
  busy,
  busyAction,
  showSetup,
  onApiKeyChange,
  onTestEmailChange,
  onShowSetupChange,
  onSetup,
  onDisconnect,
  onVerify,
  onCopy,
  onTest,
  onEnable,
}: {
  settings: PlatformSettingsView;
  apiKey: string;
  testEmail: string;
  busy: boolean;
  busyAction: string | null;
  showSetup: boolean;
  onApiKeyChange: (value: string) => void;
  onTestEmailChange: (value: string) => void;
  onShowSetupChange: (show: boolean) => void;
  onSetup: () => Promise<void>;
  onDisconnect: () => Promise<void>;
  onVerify: () => Promise<void>;
  onCopy: (value: string) => Promise<void>;
  onTest: () => Promise<void>;
  onEnable: () => Promise<boolean>;
}) {
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
        testEmail={testEmail}
        busy={busy}
        onTestEmailChange={onTestEmailChange}
        onTest={onTest}
        onEnable={onEnable}
        onEdit={() => onShowSetupChange(true)}
      />
    );
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
      <TextField
        label="Resend API Key"
        type="password"
        value={apiKey}
        onChange={(event) => onApiKeyChange(event.target.value)}
        required={!settings.hasResendApiKey}
        helperText={
          settings.hasResendApiKey
            ? "已加密保存；留空表示不修改"
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
            onClick={() => void onDisconnect()}
            disabled={busy}
          >
            清除 Resend 配置
          </Button>
        ) : null}
        <Button
          variant="contained"
          onClick={() => void onSetup()}
          disabled={
            busy ||
            !settings.hasDedicatedEncryptionKey ||
            (!settings.hasResendApiKey && !apiKey.trim())
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
          testEmail={testEmail}
          busy={busy}
          onTestEmailChange={onTestEmailChange}
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
  testEmail,
  busy,
  onTestEmailChange,
  onTest,
  onEnable,
  onEdit,
  compact = false,
}: {
  settings: PlatformSettingsView;
  testEmail: string;
  busy: boolean;
  onTestEmailChange: (value: string) => void;
  onTest: () => Promise<void>;
  onEnable: () => Promise<boolean>;
  onEdit?: () => void;
  compact?: boolean;
}) {
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
        <TextField
          label="测试收件邮箱"
          type="email"
          value={testEmail}
          onChange={(event) => onTestEmailChange(event.target.value)}
          fullWidth
        />
        <Button
          variant="outlined"
          onClick={() => void onTest()}
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
