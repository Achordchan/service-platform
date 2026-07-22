"use client";

import { useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
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
  MailOutboxSummary,
  PlatformSettingsView,
} from "@/components/staff/platform-settings-types";

export type {
  MailMessageView,
  PlatformSettingsView,
} from "@/components/staff/platform-settings-types";

const statusLabel = {
  QUEUED: "排队中",
  PROCESSING: "发送中",
  SENT: "已提交",
  DELIVERY_DELAYED: "投递延迟",
  DELIVERED: "已送达",
  BOUNCED: "已退信",
  COMPLAINED: "被投诉",
  SUPPRESSED: "已拦截",
  FAILED: "失败",
  CANCELLED: "已取消",
} as const;

const statusColor = {
  QUEUED: "default",
  PROCESSING: "info",
  SENT: "info",
  DELIVERY_DELAYED: "warning",
  DELIVERED: "success",
  BOUNCED: "error",
  COMPLAINED: "error",
  SUPPRESSED: "error",
  FAILED: "error",
  CANCELLED: "default",
} as const;

const deliveryModeLabel = {
  LOCAL_OUTBOX: "未启用",
  RESEND: "Resend",
  SMTP: "SMTP",
} as const;

export type PlatformSettingsSection = "site-mail" | "attachments" | "outbox";

export function PlatformSettingsManager({
  initialSettings,
  initialMessages,
  initialMailOutboxSummary,
  currentAdminEmail,
  sections,
  embedded = false,
  onSettingsChange,
  onMailOutboxSummaryChange,
}: {
  initialSettings: PlatformSettingsView;
  initialMessages: MailMessageView[];
  initialMailOutboxSummary: MailOutboxSummary;
  currentAdminEmail: string;
  sections?: PlatformSettingsSection[];
  embedded?: boolean;
  onSettingsChange?: (settings: PlatformSettingsView) => void;
  onMailOutboxSummaryChange?: (summary: MailOutboxSummary) => void;
}) {
  const [settings, setSettings] = useState(initialSettings);
  const [messages, setMessages] = useState(initialMessages);
  const [mailOutboxSummary, setMailOutboxSummary] = useState(
    initialMailOutboxSummary,
  );
  const [customerReplyAttachmentsEnabled, setCustomerReplyAttachmentsEnabled] =
    useState(initialSettings.customerReplyAttachmentsEnabled);
  const [submitting, setSubmitting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [messageAction, setMessageAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [selectedMessage, setSelectedMessage] =
    useState<MailMessageView | null>(null);
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
      onSettingsChange?.(next);
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
      const [next, nextSummary] = await Promise.all([
        staffApi<MailMessageView[]>("/api/v1/admin/mail-messages?limit=50"),
        staffApi<MailOutboxSummary>("/api/v1/admin/mail-messages/summary"),
      ]);
      setMessages(next);
      setMailOutboxSummary(nextSummary);
      onMailOutboxSummaryChange?.(nextSummary);
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

  async function retryMessage(mailMessageId: string) {
    setMessageAction(`${mailMessageId}:retry`);
    setError(null);
    setSuccess(null);
    try {
      await staffApi(
        `/api/v1/admin/mail-messages/${mailMessageId}/retry`,
        jsonRequest("POST", {}),
      );
      setSuccess("邮件已使用当前发信通道重新入队");
      await refreshMessages();
    } catch (retryError) {
      setError(
        retryError instanceof Error ? retryError.message : "邮件重试失败",
      );
    } finally {
      setMessageAction(null);
    }
  }

  async function cancelMessage(mailMessageId: string) {
    if (!window.confirm("确认取消这封排队中的邮件？")) return;
    setMessageAction(`${mailMessageId}:cancel`);
    setError(null);
    setSuccess(null);
    try {
      await staffApi(`/api/v1/admin/mail-messages/${mailMessageId}`, {
        method: "DELETE",
      });
      setSuccess("邮件已取消");
      await refreshMessages();
    } catch (cancelError) {
      setError(
        cancelError instanceof Error ? cancelError.message : "取消失败",
      );
    } finally {
      setMessageAction(null);
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
      <Paper
        variant="outlined"
        sx={{
          p: embedded ? 0 : { xs: 2.5, md: 3 },
          border: embedded ? 0 : undefined,
        }}
      >
        <Stack key={`attachments-${settings.updatedAt ?? "init"}`} spacing={2.5} component="form" onSubmit={handleSubmit}>
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
      <Paper
        variant="outlined"
        sx={{
          p: embedded ? 0 : { xs: 2.5, md: 3 },
          border: embedded ? 0 : undefined,
        }}
      >
        <Stack
          direction="row"
          spacing={1}
          useFlexGap
          sx={{ mb: 2, flexWrap: "wrap" }}
        >
          <Chip size="small" label={`排队 ${mailOutboxSummary.queued}`} />
          <Chip
            size="small"
            label={`逾期 ${mailOutboxSummary.overdue}`}
            color={mailOutboxSummary.overdue > 0 ? "error" : "default"}
          />
          <Chip
            size="small"
            label={`失败 ${mailOutboxSummary.failed}`}
            color={mailOutboxSummary.failed > 0 ? "error" : "default"}
          />
          <Chip
            size="small"
            label={`已取消 ${mailOutboxSummary.cancelled}`}
          />
        </Stack>
        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={1.5}
          sx={{
            mb: 2,
            alignItems: { xs: "stretch", sm: "center" },
            justifyContent: "flex-end",
          }}
        >
          <Button onClick={refreshMessages} disabled={refreshing}>
            {refreshing ? "刷新中" : "刷新"}
          </Button>
        </Stack>
        {messages.length === 0 ? (
          <Alert severity="info">暂无邮件记录</Alert>
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
                      {message.status === "QUEUED" &&
                      new Date(message.sendAfter).getTime() <=
                        new Date(mailOutboxSummary.asOf).getTime() -
                          2 * 60 * 1000 ? (
                        <Typography
                          color="error"
                          variant="caption"
                          sx={{ display: "block", fontWeight: 700 }}
                        >
                          已逾期超过 2 分钟
                        </Typography>
                      ) : null}
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
                      {message.attemptCount > 0 ? (
                        <Typography
                          color="text.secondary"
                          variant="caption"
                          sx={{ display: "block" }}
                        >
                          尝试 {message.attemptCount} 次
                        </Typography>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <Stack
                        direction="row"
                        spacing={0.5}
                        useFlexGap
                        sx={{ flexWrap: "wrap" }}
                      >
                        <Button
                          size="small"
                          onClick={() => setSelectedMessage(message)}
                        >
                          查看内容
                        </Button>
                        {message.actionUrl ? (
                        <Button
                          size="small"
                          href={message.actionUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          打开链接
                        </Button>
                        ) : null}
                        {message.status === "QUEUED" ||
                        message.status === "FAILED" ||
                        message.status === "CANCELLED" ? (
                          <Button
                            size="small"
                            disabled={messageAction !== null}
                            onClick={() => retryMessage(message.id)}
                          >
                            {messageAction === `${message.id}:retry`
                              ? "入队中"
                              : "重试"}
                          </Button>
                        ) : null}
                        {message.status === "QUEUED" ? (
                          <Button
                            size="small"
                            color="inherit"
                            disabled={messageAction !== null}
                            onClick={() => cancelMessage(message.id)}
                          >
                            {messageAction === `${message.id}:cancel`
                              ? "取消中"
                              : "取消"}
                          </Button>
                        ) : null}
                      </Stack>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
        )}
      </Paper>
      ) : null}

      <Dialog
        open={Boolean(selectedMessage)}
        onClose={() => setSelectedMessage(null)}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>邮件内容</DialogTitle>
        <DialogContent dividers>
          {selectedMessage ? (
            <Stack spacing={2}>
              <Box>
                <Typography variant="caption" color="text.secondary">
                  收件人
                </Typography>
                <Typography sx={{ wordBreak: "break-all" }}>
                  {selectedMessage.toEmail}
                </Typography>
              </Box>
              <Box>
                <Typography variant="caption" color="text.secondary">
                  主题
                </Typography>
                <Typography sx={{ fontWeight: 700 }}>
                  {selectedMessage.subject}
                </Typography>
                {selectedMessage.previewText ? (
                  <Typography variant="body2" color="text.secondary">
                    {selectedMessage.previewText}
                  </Typography>
                ) : null}
              </Box>
              <Paper
                variant="outlined"
                sx={{ p: { xs: 2, sm: 2.5 }, overflow: "hidden" }}
              >
                <Typography variant="h3" sx={{ fontSize: 20, fontWeight: 700 }}>
                  {selectedMessage.heading}
                </Typography>
                <Typography
                  color="text.secondary"
                  sx={{
                    mt: 1,
                    whiteSpace: "pre-line",
                    overflowWrap: "anywhere",
                  }}
                >
                  {selectedMessage.body}
                </Typography>
                {selectedMessage.actionLabel && selectedMessage.actionUrl ? (
                  <Button
                    variant="contained"
                    size="small"
                    href={selectedMessage.actionUrl}
                    target="_blank"
                    rel="noreferrer"
                    sx={{ mt: 2 }}
                  >
                    {selectedMessage.actionLabel}
                  </Button>
                ) : null}
              </Paper>
              <Typography variant="caption" color="text.secondary">
                模板：{selectedMessage.templateKey ?? "历史自定义内容"} ·
                发送方式：{deliveryModeLabel[selectedMessage.deliveryMode]} ·
                尝试次数：{selectedMessage.attemptCount}
              </Typography>
            </Stack>
          ) : null}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSelectedMessage(null)}>关闭</Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
