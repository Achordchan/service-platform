"use client";

import { useState } from "react";
import CheckCircleOutlineOutlinedIcon from "@mui/icons-material/CheckCircleOutlineOutlined";
import DeleteOutlineOutlinedIcon from "@mui/icons-material/DeleteOutlineOutlined";
import MenuBookOutlinedIcon from "@mui/icons-material/MenuBookOutlined";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
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
import {
  formatSmtpSender,
  smtpSenderName,
} from "@/modules/platform-settings/smtp-sender";

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
  const [fromName, setFromName] = useState(smtpSenderName(settings.smtpFrom));
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
  const [editing, setEditing] = useState(!configured || !healthy);
  const showOverview = configured && healthy && !editing;

  function applyGuide(guide: SmtpProviderGuide) {
    setHost(guide.host);
    setPort(guide.port);
    setSecure(guide.secure);
  }

  function cancelEditing() {
    setHost(settings.smtpHost ?? "");
    setPort(settings.smtpPort ?? 465);
    setUser(settings.smtpUser ?? "");
    setPassword("");
    setFromName(smtpSenderName(settings.smtpFrom));
    setSecure(settings.smtpSecure);
    setEditing(false);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const payload: Record<string, unknown> = {
      smtpHost: host.trim(),
      smtpPort: port,
      smtpUser: user.trim(),
      smtpFrom: formatSmtpSender(fromName, user),
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
            color={
              healthy
                ? "success"
                : settings.smtpHealthStatus === "error"
                  ? "error"
                  : "default"
            }
            variant="outlined"
          />
        </Stack>
        {!showOverview ? (
          <Button
            startIcon={<MenuBookOutlinedIcon />}
            onClick={() => setGuidesOpen(true)}
          >
            常见 SMTP 接入教程
          </Button>
        ) : null}
      </Stack>

      {!settings.hasDedicatedEncryptionKey ? (
        <Alert severity="warning">
          缺少 PLATFORM_SECRET_ENCRYPTION_KEY，不能从后台安全保存 SMTP 密码。
        </Alert>
      ) : null}
      {settings.smtpHealthStatus === "error" && settings.smtpLastError ? (
        <Alert severity="error">{settings.smtpLastError}</Alert>
      ) : null}
      {showOverview ? (
        <SmtpOverview
          settings={settings}
          busy={busy}
          testEmail={testEmail}
          onTestEmailChange={onTestEmailChange}
          onTest={onTest}
          onEnable={onEnable}
          onEdit={() => setEditing(true)}
          onDisconnect={onDisconnect}
          onOpenGuides={() => setGuidesOpen(true)}
        />
      ) : (
        <Stack
          component="form"
          spacing={2}
          onSubmit={(event) => void handleSubmit(event)}
        >
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: {
                xs: "1fr",
                md: "minmax(0, 1fr) 130px minmax(220px, auto)",
              },
              gap: 2,
              alignItems: "start",
            }}
          >
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
              required
            />
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
              aria-label="连接加密"
              sx={{ height: 56 }}
            >
              <ToggleButton value="ssl" sx={{ px: 1.5 }}>
                SSL/TLS
              </ToggleButton>
              <ToggleButton value="starttls" sx={{ px: 1.5 }}>
                STARTTLS
              </ToggleButton>
            </ToggleButtonGroup>
          </Box>
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" },
              gap: 2,
            }}
          >
            <TextField
              label="SMTP 用户名"
              type="email"
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
          </Box>
          <TextField
            label="发件人名称"
            value={fromName}
            onChange={(event) => setFromName(event.target.value)}
            helperText={`发件邮箱固定使用 ${user.trim() || "SMTP 登录邮箱"}`}
            fullWidth
            required
          />
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
            {configured && healthy ? (
              <Button onClick={cancelEditing} disabled={busy}>
                取消编辑
              </Button>
            ) : null}
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
      )}

      <SmtpProviderGuidesDialog
        open={guidesOpen}
        onClose={() => setGuidesOpen(false)}
        onApply={applyGuide}
      />
    </Stack>
  );
}

function SmtpOverview({
  settings,
  busy,
  testEmail,
  onTestEmailChange,
  onTest,
  onEnable,
  onEdit,
  onDisconnect,
  onOpenGuides,
}: {
  settings: PlatformSettingsView;
  busy: boolean;
  testEmail: string;
  onTestEmailChange: (value: string) => void;
  onTest: () => Promise<void>;
  onEnable: () => Promise<void>;
  onEdit: () => void;
  onDisconnect: () => Promise<void>;
  onOpenGuides: () => void;
}) {
  const active = settings.mailMode === "SMTP";
  return (
    <Stack spacing={2}>
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr", sm: "repeat(3, minmax(0, 1fr))" },
          gap: 2,
        }}
      >
        {[
          ["服务器", `${settings.smtpHost}:${settings.smtpPort}`],
          ["发件账号", settings.smtpUser],
          ["连接方式", settings.smtpSecure ? "SSL/TLS" : "STARTTLS"],
        ].map(([label, value]) => (
          <Box key={label} sx={{ minWidth: 0 }}>
            <Typography variant="caption" color="text.secondary">
              {label}
            </Typography>
            <Typography sx={{ mt: 0.35, overflowWrap: "anywhere" }}>
              {value}
            </Typography>
          </Box>
        ))}
      </Box>

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
          disabled={busy || !testEmail.trim()}
          sx={{ whiteSpace: "nowrap" }}
        >
          发送 SMTP 测试邮件
        </Button>
      </Box>

      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={1}
        useFlexGap
        sx={{ justifyContent: "flex-end", flexWrap: "wrap" }}
      >
        <Button startIcon={<MenuBookOutlinedIcon />} onClick={onOpenGuides}>
          接入教程
        </Button>
        <Button startIcon={<EditOutlinedIcon />} onClick={onEdit}>
          编辑配置
        </Button>
        <Button
          color="error"
          startIcon={<DeleteOutlineOutlinedIcon />}
          onClick={() => void onDisconnect()}
          disabled={busy}
        >
          清除配置
        </Button>
        <Button
          variant="contained"
          onClick={() => void onEnable()}
          disabled={busy || active}
        >
          {active ? "SMTP 已启用" : "启用 SMTP"}
        </Button>
      </Stack>

      {settings.smtpLastCheckedAt ? (
        <Typography variant="caption" color="text.secondary">
          最后检测：{new Date(settings.smtpLastCheckedAt).toLocaleString("zh-CN")}
        </Typography>
      ) : null}
    </Stack>
  );
}
