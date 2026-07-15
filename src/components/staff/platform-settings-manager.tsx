"use client";

import { useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  Divider,
  FormControl,
  FormControlLabel,
  Paper,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import { jsonRequest, staffApi } from "@/components/staff/staff-api";

export type PlatformSettingsView = {
  appUrl: string;
  mailMode: "SMTP" | "LOCAL_OUTBOX";
  smtpHost: string | null;
  smtpPort: number | null;
  smtpUser: string | null;
  smtpFrom: string;
  smtpSecure: boolean;
  hasStoredPassword: boolean;
  attachmentMaxSizeMb: number;
  attachmentAllowedExtensions: string;
  customerReplyAttachmentsEnabled: boolean;
  updatedAt?: string;
};

export type MailMessageView = {
  id: string;
  toEmail: string;
  subject: string;
  heading: string;
  body: string;
  actionLabel: string | null;
  actionUrl: string | null;
  status: "QUEUED" | "SENT" | "FAILED";
  errorMessage: string | null;
  providerId: string | null;
  sentAt: string | null;
  createdAt: string;
};

const statusLabel = {
  QUEUED: "排队中",
  SENT: "已发送",
  FAILED: "失败",
} as const;

const statusColor = {
  QUEUED: "default",
  SENT: "success",
  FAILED: "error",
} as const;

export type PlatformSettingsSection = "site-mail" | "attachments" | "outbox";

export function PlatformSettingsManager({
  initialSettings,
  initialMessages,
  sections,
}: {
  initialSettings: PlatformSettingsView;
  initialMessages: MailMessageView[];
  sections?: PlatformSettingsSection[];
}) {
  const [settings, setSettings] = useState(initialSettings);
  const [messages, setMessages] = useState(initialMessages);
  const [smtpSecure, setSmtpSecure] = useState(initialSettings.smtpSecure);
  const [customerReplyAttachmentsEnabled, setCustomerReplyAttachmentsEnabled] =
    useState(initialSettings.customerReplyAttachmentsEnabled);
  const [submitting, setSubmitting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const activeSections = sections?.length
    ? new Set(sections)
    : new Set<PlatformSettingsSection>(["site-mail", "attachments", "outbox"]);
  const showSiteMail = activeSections.has("site-mail");
  const showAttachments = activeSections.has("attachments");
  const showOutbox = activeSections.has("outbox");

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setSuccess(null);
    const form = new FormData(event.currentTarget);
    const hasMailFields = form.has("appUrl");
    const hasAttachmentFields = form.has("attachmentMaxSizeMb");
    const payload: Record<string, unknown> = {};

    if (hasMailFields) {
      const smtpPassword = String(form.get("smtpPassword") ?? "");
      payload.appUrl = String(form.get("appUrl") ?? "").trim();
      payload.mailMode = "SMTP";
      payload.smtpHost = String(form.get("smtpHost") ?? "").trim();
      payload.smtpPort = form.get("smtpPort")
        ? Number(form.get("smtpPort"))
        : null;
      payload.smtpUser = String(form.get("smtpUser") ?? "").trim();
      payload.smtpFrom = String(form.get("smtpFrom") ?? "").trim();
      payload.smtpSecure = smtpSecure;
      if (smtpPassword) {
        payload.smtpPassword = smtpPassword;
      }
    }

    if (hasAttachmentFields) {
      payload.attachmentMaxSizeMb = Number(
        form.get("attachmentMaxSizeMb") || 20,
      );
      payload.attachmentAllowedExtensions = String(
        form.get("attachmentAllowedExtensions") ?? "",
      ).trim();
      payload.customerReplyAttachmentsEnabled =
        customerReplyAttachmentsEnabled;
    }

    try {
      const next = await staffApi<PlatformSettingsView>(
        "/api/v1/admin/settings",
        jsonRequest("PATCH", payload),
      );
      setSettings(next);
      setSmtpSecure(next.smtpSecure);
      setCustomerReplyAttachmentsEnabled(next.customerReplyAttachmentsEnabled);
      setSuccess(hasAttachmentFields && !hasMailFields ? "附件策略已保存" : "平台设置已保存");
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "保存失败，请稍后重试",
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function refreshMessages() {
    setRefreshing(true);
    setError(null);
    try {
      const next = await staffApi<MailMessageView[]>(
        "/api/v1/admin/mail-messages?limit=50",
      );
      setMessages(next);
    } catch (refreshError) {
      setError(
        refreshError instanceof Error
          ? refreshError.message
          : "刷新发件箱失败",
      );
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <Stack spacing={3}>
      {error ? <Alert severity="error">{error}</Alert> : null}
      {success ? <Alert severity="success">{success}</Alert> : null}

      {showSiteMail ? (
      <Paper variant="outlined" sx={{ p: { xs: 2.5, md: 3 } }}>
        <Stack key={`mail-${settings.updatedAt ?? "init"}`} spacing={2.5} component="form" onSubmit={handleSubmit}>
          <Box>
            <Typography variant="h2" sx={{ fontSize: 20, fontWeight: 700 }}>
              站点与邮件
            </Typography>
            <Typography color="text.secondary" sx={{ mt: 0.75 }}>
              正式域名可填 https://support.achord.cn。发件与站点地址在此维护，不必改服务器环境变量。
            </Typography>
          </Box>

          <TextField
            name="appUrl"
            label="站点地址"
            defaultValue={settings.appUrl}
            required
            fullWidth
            helperText="邀请链接、邮件按钮会使用这个地址"
          />

          <Alert severity="info">
            正式环境仅支持 SMTP 外发。Cloudflare 本身不提供发信邮箱，请在企业邮箱 / Resend / 阿里云邮件推送等服务开通 SMTP，并把 SPF、DKIM 记录加到 Cloudflare DNS。发件人建议使用 info@achord.cn。
          </Alert>

          <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
            <TextField
              name="smtpHost"
              label="SMTP 主机"
              defaultValue={settings.smtpHost ?? ""}
              fullWidth
              required
              placeholder="smtp.example.com"
            />
            <TextField
              name="smtpPort"
              label="SMTP 端口"
              type="number"
              defaultValue={settings.smtpPort ?? 465}
              fullWidth
              required
              helperText="常见：465（SSL）或 587（STARTTLS）"
            />
          </Stack>

          <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
            <TextField
              name="smtpUser"
              label="SMTP 用户名"
              defaultValue={settings.smtpUser ?? ""}
              fullWidth
              required
              placeholder="info@achord.cn"
            />
            <TextField
              name="smtpPassword"
              label="SMTP 密码"
              type="password"
              fullWidth
              required={!settings.hasStoredPassword}
              helperText={
                settings.hasStoredPassword
                  ? "已保存密码；留空表示不修改"
                  : "邮箱密码或 SMTP 专用密码"
              }
            />
          </Stack>

          <TextField
            name="smtpFrom"
            label="发件人"
            defaultValue={settings.smtpFrom || "服务支持中心 <info@achord.cn>"}
            fullWidth
            required
            helperText="例如：服务支持中心 <info@achord.cn>"
          />

          <FormControlLabel
            control={
              <Switch
                checked={smtpSecure}
                onChange={(event) => setSmtpSecure(event.target.checked)}
              />
            }
            label="使用 SSL/TLS（465 端口开启；587 端口通常关闭并改用 STARTTLS）"
          />

          <Stack direction="row" spacing={1.5} sx={{ justifyContent: "flex-end" }}>
            <Button type="submit" variant="contained" disabled={submitting}>
              {submitting ? "保存中" : "保存设置"}
            </Button>
          </Stack>
        </Stack>
      </Paper>
      ) : null}

      {showAttachments ? (
      <Paper variant="outlined" sx={{ p: { xs: 2.5, md: 3 } }}>
        <Stack key={`attachments-${settings.updatedAt ?? "init"}`} spacing={2.5} component="form" onSubmit={handleSubmit}>
          <Box>
            <Typography variant="h2" sx={{ fontSize: 20, fontWeight: 700 }}>
              附件策略
            </Typography>
            <Typography color="text.secondary" sx={{ mt: 0.75 }}>
              统一限制工单与项目文件的上传规则，独立于邮件配置。
            </Typography>
          </Box>
          <TextField
            name="attachmentMaxSizeMb"
            label="单文件大小上限（MB）"
            type="number"
            defaultValue={settings.attachmentMaxSizeMb}
            fullWidth
            slotProps={{ htmlInput: { min: 1, max: 100 } }}
          />
          <TextField
            name="attachmentAllowedExtensions"
            label="允许的后缀"
            defaultValue={settings.attachmentAllowedExtensions}
            fullWidth
            helperText="用逗号分隔，例如 jpg,png,pdf,docx"
          />
          <FormControlLabel
            control={
              <Switch
                checked={customerReplyAttachmentsEnabled}
                onChange={(event) =>
                  setCustomerReplyAttachmentsEnabled(event.target.checked)
                }
              />
            }
            label="允许客户在工单回复中添加附件 / 粘贴图片"
          />
          <Stack direction="row" spacing={1.5} sx={{ justifyContent: "flex-end" }}>
            <Button type="submit" variant="contained" disabled={submitting}>
              {submitting ? "保存中" : "保存附件策略"}
            </Button>
          </Stack>
        </Stack>
      </Paper>
      ) : null}

      {showOutbox ? (
      <Paper variant="outlined" sx={{ p: { xs: 2.5, md: 3 } }}>
        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={1.5}
          sx={{
            mb: 2,
            alignItems: { xs: "stretch", sm: "center" },
            justifyContent: "space-between",
          }}
        >
          <Box>
            <Typography variant="h2" sx={{ fontSize: 20, fontWeight: 700 }}>
              发件箱
            </Typography>
            <Typography color="text.secondary" sx={{ mt: 0.5 }}>
              记录邀请与通知的外发结果；失败时在此查看错误原因。
            </Typography>
          </Box>
          <Button onClick={refreshMessages} disabled={refreshing}>
            {refreshing ? "刷新中" : "刷新"}
          </Button>
        </Stack>
        <Divider sx={{ mb: 2 }} />
        {messages.length === 0 ? (
          <Alert severity="info">还没有邮件记录</Alert>
        ) : (
          <Box sx={{ overflowX: "auto" }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>时间</TableCell>
                  <TableCell>收件人</TableCell>
                  <TableCell>主题</TableCell>
                  <TableCell>状态</TableCell>
                  <TableCell>操作</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {messages.map((message) => (
                  <TableRow key={message.id} hover>
                    <TableCell sx={{ whiteSpace: "nowrap" }}>
                      {new Date(message.createdAt).toLocaleString("zh-CN")}
                    </TableCell>
                    <TableCell>{message.toEmail}</TableCell>
                    <TableCell>
                      <Typography sx={{ fontWeight: 600 }}>
                        {message.subject}
                      </Typography>
                      <Typography color="text.secondary" variant="body2">
                        {message.heading}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Chip
                        size="small"
                        label={statusLabel[message.status]}
                        color={statusColor[message.status]}
                      />
                      {message.errorMessage ? (
                        <Typography color="error" variant="caption" sx={{ display: "block" }}>
                          {message.errorMessage}
                        </Typography>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      {message.actionUrl ? (
                        <Button
                          size="small"
                          href={message.actionUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          打开链接
                        </Button>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
        )}
      </Paper>
      ) : null}
    </Stack>
  );
}
