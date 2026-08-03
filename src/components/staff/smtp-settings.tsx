"use client";

import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm, useFormContext, useWatch } from "react-hook-form";
import { z } from "zod";
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
import type { MailSettingsFormValues } from "@/components/staff/mail-settings-form";
import {
  formatSmtpSender,
  smtpSenderName,
} from "@/modules/platform-settings/smtp-sender";

const smtpFormSchema = z.object({
  host: z.string().trim().min(1, "请填写 SMTP 主机").max(255),
  port: z.number().int().min(1).max(65535),
  user: z.email("请输入有效的 SMTP 登录邮箱").max(255),
  password: z.string().max(255),
  fromName: z.string().trim().min(1, "请填写发件人名称").max(160),
  secure: z.boolean(),
});

type SmtpFormValues = z.infer<typeof smtpFormSchema>;

export function SmtpSettings({
  settings,
  busy,
  onSave,
  onCheck,
  onTest,
  onEnable,
  onDisconnect,
}: {
  settings: PlatformSettingsView;
  busy: boolean;
  onSave: (payload: Record<string, unknown>) => Promise<boolean>;
  onCheck: () => Promise<void>;
  onTest: (testEmail: string) => Promise<void>;
  onEnable: () => Promise<void>;
  onDisconnect: () => Promise<void>;
}) {
  const [guidesOpen, setGuidesOpen] = useState(false);
  const form = useForm<SmtpFormValues>({
    resolver: zodResolver(smtpFormSchema),
    defaultValues: {
      host: settings.smtpHost ?? "",
      port: settings.smtpPort ?? 465,
      user: settings.smtpUser ?? "",
      password: "",
      fromName: smtpSenderName(settings.smtpFrom),
      secure: settings.smtpSecure,
    },
  });
  const user = useWatch({ control: form.control, name: "user" });
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
    form.setValue("host", guide.host, { shouldDirty: true });
    form.setValue("port", guide.port, { shouldDirty: true });
    form.setValue("secure", guide.secure, { shouldDirty: true });
  }

  function cancelEditing() {
    form.reset({
      host: settings.smtpHost ?? "",
      port: settings.smtpPort ?? 465,
      user: settings.smtpUser ?? "",
      password: "",
      fromName: smtpSenderName(settings.smtpFrom),
      secure: settings.smtpSecure,
    });
    setEditing(false);
  }

  const handleSubmit = form.handleSubmit(async (values) => {
    if (!settings.hasStoredPassword && !values.password) {
      form.setError("password", { message: "请填写 SMTP 密码或授权码" });
      return;
    }
    const payload: Record<string, unknown> = {
      smtpHost: values.host,
      smtpPort: values.port,
      smtpUser: values.user,
      smtpFrom: formatSmtpSender(values.fromName, values.user),
      smtpSecure: values.secure,
    };
    if (values.password) payload.smtpPassword = values.password;
    const saved = await onSave(payload);
    if (saved) form.setValue("password", "");
  });

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
          onSubmit={handleSubmit}
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
            <Controller
              name="host"
              control={form.control}
              render={({ field }) => (
                <TextField
                  {...field}
                  label="SMTP 主机"
                  placeholder="smtp.example.com"
                  fullWidth
                  required
                  error={Boolean(form.formState.errors.host)}
                  helperText={form.formState.errors.host?.message}
                />
              )}
            />
            <Controller
              name="port"
              control={form.control}
              render={({ field }) => (
                <TextField
                  {...field}
                  label="SMTP 端口"
                  type="number"
                  onChange={(event) => field.onChange(Number(event.target.value))}
                  error={Boolean(form.formState.errors.port)}
                  helperText={form.formState.errors.port?.message}
                  slotProps={{ htmlInput: { min: 1, max: 65535 } }}
                  required
                />
              )}
            />
            <Controller
              name="secure"
              control={form.control}
              render={({ field }) => (
                <ToggleButtonGroup
                  exclusive
                  value={field.value ? "ssl" : "starttls"}
                  onChange={(_, value: "ssl" | "starttls" | null) => {
                    if (!value) return;
                    const nextSecure = value === "ssl";
                    field.onChange(nextSecure);
                    const port = form.getValues("port");
                    if (port === 465 || port === 587) {
                      form.setValue("port", nextSecure ? 465 : 587, {
                        shouldDirty: true,
                      });
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
              )}
            />
          </Box>
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" },
              gap: 2,
            }}
          >
            <Controller
              name="user"
              control={form.control}
              render={({ field }) => (
                <TextField
                  {...field}
                  label="SMTP 用户名"
                  type="email"
                  autoComplete="off"
                  fullWidth
                  required
                  error={Boolean(form.formState.errors.user)}
                  helperText={form.formState.errors.user?.message}
                />
              )}
            />
            <Controller
              name="password"
              control={form.control}
              render={({ field }) => (
                <TextField
                  {...field}
                  label="SMTP 密码或授权码"
                  type="password"
                  autoComplete="new-password"
                  fullWidth
                  required={!settings.hasStoredPassword}
                  error={Boolean(form.formState.errors.password)}
                  helperText={
                    form.formState.errors.password?.message ??
                    (settings.hasStoredPassword
                      ? "已加密保存；留空表示不修改"
                      : "请填写邮箱授权码、应用专用密码或 SMTP 密码")
                  }
                />
              )}
            />
          </Box>
          <Controller
            name="fromName"
            control={form.control}
            render={({ field }) => (
              <TextField
                {...field}
                label="发件人名称"
                helperText={
                  form.formState.errors.fromName?.message ??
                  `发件邮箱固定使用 ${user.trim() || "SMTP 登录邮箱"}`
                }
                error={Boolean(form.formState.errors.fromName)}
                fullWidth
                required
              />
            )}
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
              disabled={
                busy ||
                form.formState.isSubmitting ||
                !settings.hasDedicatedEncryptionKey
              }
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
  onTest,
  onEnable,
  onEdit,
  onDisconnect,
  onOpenGuides,
}: {
  settings: PlatformSettingsView;
  busy: boolean;
  onTest: (testEmail: string) => Promise<void>;
  onEnable: () => Promise<void>;
  onEdit: () => void;
  onDisconnect: () => Promise<void>;
  onOpenGuides: () => void;
}) {
  const form = useFormContext<MailSettingsFormValues>();
  const testEmail = useWatch({ control: form.control, name: "testEmail" });

  async function submitTest() {
    const valid = await form.trigger("testEmail");
    if (!valid) return;
    await onTest(testEmail.trim());
  }

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
          startIcon={<ScienceOutlinedIcon />}
          onClick={() => void submitTest()}
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
