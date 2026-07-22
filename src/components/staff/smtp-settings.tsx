"use client";

import { useState } from "react";
import CheckCircleOutlineOutlinedIcon from "@mui/icons-material/CheckCircleOutlineOutlined";
import DeleteOutlineOutlinedIcon from "@mui/icons-material/DeleteOutlineOutlined";
import MenuBookOutlinedIcon from "@mui/icons-material/MenuBookOutlined";
import SaveOutlinedIcon from "@mui/icons-material/SaveOutlined";
import ScienceOutlinedIcon from "@mui/icons-material/ScienceOutlined";
import {
  Alert,
  Box,
  Button,
  Chip,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
import type { PlatformSettingsView } from "@/components/staff/platform-settings-types";
import { SmtpProviderGuidesDialog } from "@/components/staff/smtp-provider-guides-dialog";
import type { SmtpProviderGuide } from "@/components/staff/smtp-provider-guides";

export function SmtpSettings({
  settings,
  busy,
  testEmail,
  onTestEmailChange,
  onSave,
  onCheck,
  onTest,
  onEnable,
  onDisconnect,
}: {
  settings: PlatformSettingsView;
  busy: boolean;
  testEmail: string;
  onTestEmailChange: (value: string) => void;
  onSave: (payload: Record<string, unknown>) => Promise<boolean>;
  onCheck: () => Promise<void>;
  onTest: () => Promise<void>;
  onEnable: () => Promise<void>;
  onDisconnect: () => Promise<void>;
}) {
  const [host, setHost] = useState(settings.smtpHost ?? "");
  const [port, setPort] = useState(settings.smtpPort ?? 465);
  const [user, setUser] = useState(settings.smtpUser ?? "");
  const [password, setPassword] = useState("");
  const [from, setFrom] = useState(settings.smtpFrom);
  const [secure, setSecure] = useState(settings.smtpSecure);
  const [guidesOpen, setGuidesOpen] = useState(false);
  const configured = Boolean(
    settings.smtpHost &&
      settings.smtpPort &&
      settings.smtpUser &&
      settings.smtpFrom &&
      settings.hasStoredPassword,
  );
  const healthy = settings.smtpHealthStatus === "healthy";
  const active = settings.mailMode === "SMTP";

  function applyGuide(guide: SmtpProviderGuide) {
    setHost(guide.host);
    setPort(guide.port);
    setSecure(guide.secure);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const payload: Record<string, unknown> = {
      smtpHost: host.trim(),
      smtpPort: port,
      smtpUser: user.trim(),
      smtpFrom: from.trim(),
      smtpSecure: secure,
    };
    if (password) payload.smtpPassword = password;
    const saved = await onSave(payload);
    if (saved) setPassword("");
  }

  return (
    <Stack spacing={2.5}>
      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={1}
        sx={{ justifyContent: "space-between", alignItems: { sm: "center" } }}
      >
        <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap" }}>
          <Chip
            label={active ? "SMTP 当前启用" : "SMTP 未启用"}
            color={active ? "success" : "default"}
          />
          <Chip
            label={
              healthy
                ? "连接正常"
                : settings.smtpHealthStatus === "error"
                  ? "检测失败"
                  : configured
                    ? "等待检测"
                    : "尚未配置"
            }
            color={healthy ? "success" : settings.smtpHealthStatus === "error" ? "error" : "default"}
            variant="outlined"
          />
        </Stack>
        <Button
          startIcon={<MenuBookOutlinedIcon />}
          onClick={() => setGuidesOpen(true)}
        >
          常见 SMTP 接入教程
        </Button>
      </Stack>

      {!settings.hasDedicatedEncryptionKey ? (
        <Alert severity="warning">
          缺少 PLATFORM_SECRET_ENCRYPTION_KEY，不能从后台安全保存 SMTP 密码。
        </Alert>
      ) : null}
      {settings.smtpHealthStatus === "error" && settings.smtpLastError ? (
        <Alert severity="error">{settings.smtpLastError}</Alert>
      ) : null}
      {active ? (
        <Alert severity="success">
          当前邮件由 SMTP 通道投递。启用 Resend 时会自动切换，SMTP 配置仍会保留。
        </Alert>
      ) : null}

      <Stack
        component="form"
        spacing={2}
        onSubmit={(event) => void handleSubmit(event)}
      >
        <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
          <TextField
            label="SMTP 主机"
            value={host}
            onChange={(event) => setHost(event.target.value)}
            placeholder="smtp.example.com"
            fullWidth
            required
          />
          <TextField
            label="SMTP 端口"
            type="number"
            value={port}
            onChange={(event) => setPort(Number(event.target.value))}
            slotProps={{ htmlInput: { min: 1, max: 65535 } }}
            fullWidth
            required
          />
        </Stack>
        <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
          <TextField
            label="SMTP 用户名"
            value={user}
            onChange={(event) => setUser(event.target.value)}
            autoComplete="off"
            fullWidth
            required
          />
          <TextField
            label="SMTP 密码或授权码"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="new-password"
            fullWidth
            required={!settings.hasStoredPassword}
            helperText={
              settings.hasStoredPassword
                ? "已加密保存；留空表示不修改"
                : "请填写邮箱授权码、应用专用密码或 SMTP 密码"
            }
          />
        </Stack>
        <TextField
          label="SMTP 发件人"
          value={from}
          onChange={(event) => setFrom(event.target.value)}
          placeholder="服务支持中心 <support@example.com>"
          helperText="发件地址必须是服务商允许使用的邮箱或发信身份"
          fullWidth
          required
        />
        <Box>
          <Typography variant="body2" sx={{ mb: 1, fontWeight: 700 }}>
            连接加密
          </Typography>
          <ToggleButtonGroup
            exclusive
            value={secure ? "ssl" : "starttls"}
            onChange={(_, value: "ssl" | "starttls" | null) => {
              if (!value) return;
              const nextSecure = value === "ssl";
              setSecure(nextSecure);
              if (port === 465 || port === 587) {
                setPort(nextSecure ? 465 : 587);
              }
            }}
            size="small"
          >
            <ToggleButton value="ssl">SSL/TLS（常用 465）</ToggleButton>
            <ToggleButton value="starttls">STARTTLS（常用 587）</ToggleButton>
          </ToggleButtonGroup>
        </Box>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
          <Button
            type="submit"
            variant="outlined"
            startIcon={<SaveOutlinedIcon />}
            disabled={busy || !settings.hasDedicatedEncryptionKey}
          >
            保存 SMTP 配置
          </Button>
          <Button
            variant="outlined"
            startIcon={<CheckCircleOutlineOutlinedIcon />}
            onClick={() => void onCheck()}
            disabled={busy || !configured}
          >
            检测连接
          </Button>
          <Button
            color="error"
            startIcon={<DeleteOutlineOutlinedIcon />}
            onClick={() => void onDisconnect()}
            disabled={busy || (!configured && !active)}
            sx={{ ml: { sm: "auto" } }}
          >
            清除 SMTP 配置
          </Button>
        </Stack>
      </Stack>

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
          startIcon={<ScienceOutlinedIcon />}
          onClick={() => void onTest()}
          disabled={busy || !healthy || !testEmail.trim()}
          sx={{ whiteSpace: "nowrap" }}
        >
          发送 SMTP 测试邮件
        </Button>
      </Box>

      <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ justifyContent: "flex-end" }}>
        <Button
          variant="contained"
          onClick={() => void onEnable()}
          disabled={busy || !healthy || active}
        >
          {active ? "SMTP 已启用" : "启用 SMTP"}
        </Button>
      </Stack>

      {settings.smtpLastCheckedAt ? (
        <Typography variant="caption" color="text.secondary">
          最后检测：{new Date(settings.smtpLastCheckedAt).toLocaleString("zh-CN")}
        </Typography>
      ) : null}

      <SmtpProviderGuidesDialog
        open={guidesOpen}
        onClose={() => setGuidesOpen(false)}
        onApply={applyGuide}
      />
    </Stack>
  );
}
