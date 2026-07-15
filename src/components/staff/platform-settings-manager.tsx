"use client";

import { useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  Divider,
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
import { MailSettingsPanel } from "@/components/staff/mail-settings-panel";
import type {
  MailMessageView,
  PlatformSettingsView,
} from "@/components/staff/platform-settings-types";

export type {
  MailMessageView,
  PlatformSettingsView,
} from "@/components/staff/platform-settings-types";

const statusLabel = {
  QUEUED: "排队中",
  SENT: "已提交",
  DELIVERY_DELAYED: "投递延迟",
  DELIVERED: "已送达",
  BOUNCED: "已退信",
  COMPLAINED: "被投诉",
  SUPPRESSED: "已拦截",
  FAILED: "失败",
} as const;

const statusColor = {
  QUEUED: "default",
  SENT: "info",
  DELIVERY_DELAYED: "warning",
  DELIVERED: "success",
  BOUNCED: "error",
  COMPLAINED: "error",
  SUPPRESSED: "error",
  FAILED: "error",
} as const;

const deliveryModeLabel = {
  LOCAL_OUTBOX: "本地",
  RESEND: "Resend",
  SMTP: "SMTP",
} as const;

export type PlatformSettingsSection = "site-mail" | "attachments" | "outbox";

export function PlatformSettingsManager({
  initialSettings,
  initialMessages,
  currentAdminEmail,
  sections,
}: {
  initialSettings: PlatformSettingsView;
  initialMessages: MailMessageView[];
  currentAdminEmail: string;
  sections?: PlatformSettingsSection[];
}) {
  const [settings, setSettings] = useState(initialSettings);
  const [messages, setMessages] = useState(initialMessages);
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
    const hasAttachmentFields = form.has("attachmentMaxSizeMb");
    const payload: Record<string, unknown> = {};

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
      setCustomerReplyAttachmentsEnabled(next.customerReplyAttachmentsEnabled);
      setSuccess("附件策略已保存");
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
        <MailSettingsPanel
          settings={settings}
          currentAdminEmail={currentAdminEmail}
          onSettingsChange={setSettings}
        />
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
                  <TableCell>方式</TableCell>
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
                      {deliveryModeLabel[message.deliveryMode]}
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
                      {message.lastEventAt ? (
                        <Typography
                          color="text.secondary"
                          variant="caption"
                          sx={{ display: "block" }}
                        >
                          {new Date(message.lastEventAt).toLocaleString("zh-CN")}
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
