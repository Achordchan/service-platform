"use client";

import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";
import {
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
  TextField,
  Typography,
} from "@mui/material";
import { useAppConfirm } from "@/components/shared/confirm-provider";
import { jsonRequest, staffApi } from "@/components/staff/staff-api";
import { useToast } from "@/components/shared/toast-provider";
import {
  deliveryModeLabel,
  MailMessageGrid,
} from "@/components/staff/mail-message-grid";
import { MailSettingsPanel } from "@/components/staff/mail-settings-panel";
import type {
  MailMessageView,
  MailOutboxSummary,
  PlatformSettingsView,
} from "@/components/staff/platform-settings-types";
import { queryKeys } from "@/lib/query-keys";

export type {
  MailMessageView,
  PlatformSettingsView,
} from "@/components/staff/platform-settings-types";

export type PlatformSettingsSection = "site-mail" | "attachments" | "outbox";

const attachmentPolicyFormSchema = z.object({
  attachmentMaxSizeMb: z.number().int().min(1).max(100),
  attachmentAllowedExtensions: z.string().trim().max(500),
  customerReplyAttachmentsEnabled: z.boolean(),
});

type AttachmentPolicyFormValues = z.infer<typeof attachmentPolicyFormSchema>;

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
  const confirm = useAppConfirm();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [settings, setSettings] = useState(initialSettings);
  const [messages, setMessages] = useState(initialMessages);
  const [mailOutboxSummary, setMailOutboxSummary] = useState(
    initialMailOutboxSummary,
  );
  const attachmentForm = useForm<AttachmentPolicyFormValues>({
    resolver: zodResolver(attachmentPolicyFormSchema),
    defaultValues: {
      attachmentMaxSizeMb: initialSettings.attachmentMaxSizeMb,
      attachmentAllowedExtensions: initialSettings.attachmentAllowedExtensions,
      customerReplyAttachmentsEnabled:
        initialSettings.customerReplyAttachmentsEnabled,
    },
  });
  const [refreshing, setRefreshing] = useState(false);
  const [messageAction, setMessageAction] = useState<string | null>(null);
  const [selectedMessage, setSelectedMessage] =
    useState<MailMessageView | null>(null);
  const activeSections = sections?.length
    ? new Set(sections)
    : new Set<PlatformSettingsSection>(["site-mail", "attachments", "outbox"]);
  const showSiteMail = activeSections.has("site-mail");
  const showAttachments = activeSections.has("attachments");
  const showOutbox = activeSections.has("outbox");

  const handleAttachmentSubmit = attachmentForm.handleSubmit(async (values) => {
    try {
      const next = await staffApi<PlatformSettingsView>(
        "/api/v1/admin/settings",
        jsonRequest("PATCH", values),
      );
      setSettings(next);
      onSettingsChange?.(next);
      attachmentForm.reset({
        attachmentMaxSizeMb: next.attachmentMaxSizeMb,
        attachmentAllowedExtensions: next.attachmentAllowedExtensions,
        customerReplyAttachmentsEnabled: next.customerReplyAttachmentsEnabled,
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.attachmentPolicy,
      });
      toast.success("附件策略已保存");
    } catch (submitError) {
      toast.error(
        submitError instanceof Error
          ? submitError.message
          : "保存失败，请稍后重试",
      );
    }
  });

  async function refreshMessages() {
    setRefreshing(true);
    try {
      const [next, nextSummary] = await Promise.all([
        staffApi<MailMessageView[]>("/api/v1/admin/mail-messages?limit=50"),
        staffApi<MailOutboxSummary>("/api/v1/admin/mail-messages/summary"),
      ]);
      setMessages(next);
      setMailOutboxSummary(nextSummary);
      onMailOutboxSummaryChange?.(nextSummary);
    } catch (refreshError) {
      toast.error(
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
    try {
      await staffApi(
        `/api/v1/admin/mail-messages/${mailMessageId}/retry`,
        jsonRequest("POST", {}),
      );
      toast.success("邮件已使用当前发信通道重新入队");
      await refreshMessages();
    } catch (retryError) {
      toast.error(
        retryError instanceof Error ? retryError.message : "邮件重试失败",
      );
    } finally {
      setMessageAction(null);
    }
  }

  async function cancelMessage(mailMessageId: string) {
    const confirmed = await confirm({
      title: "取消排队中的邮件？",
      description: "取消后，这封邮件不会继续发送。",
      confirmationText: "确认取消",
      confirmationButtonProps: { color: "error", variant: "contained" },
    });
    if (!confirmed) return;
    setMessageAction(`${mailMessageId}:cancel`);
    try {
      await staffApi(`/api/v1/admin/mail-messages/${mailMessageId}`, {
        method: "DELETE",
      });
      toast.success("邮件已取消");
      await refreshMessages();
    } catch (cancelError) {
      toast.error(
        cancelError instanceof Error ? cancelError.message : "取消失败",
      );
    } finally {
      setMessageAction(null);
    }
  }

  return (
    <Stack spacing={3}>
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
        <Stack spacing={2.5} component="form" onSubmit={handleAttachmentSubmit}>
          <Controller
            name="attachmentMaxSizeMb"
            control={attachmentForm.control}
            render={({ field }) => (
              <TextField
                {...field}
                label="单文件大小上限（MB）"
                type="number"
                onChange={(event) => field.onChange(Number(event.target.value))}
                fullWidth
                error={Boolean(attachmentForm.formState.errors.attachmentMaxSizeMb)}
                helperText={attachmentForm.formState.errors.attachmentMaxSizeMb?.message}
                slotProps={{ htmlInput: { min: 1, max: 100 } }}
              />
            )}
          />
          <Controller
            name="attachmentAllowedExtensions"
            control={attachmentForm.control}
            render={({ field }) => (
              <TextField
                {...field}
                label="允许的后缀"
                fullWidth
                error={Boolean(attachmentForm.formState.errors.attachmentAllowedExtensions)}
                helperText={
                  attachmentForm.formState.errors.attachmentAllowedExtensions?.message ??
                  "用逗号分隔，例如 jpg,png,pdf,docx"
                }
              />
            )}
          />
          <FormControlLabel
            control={
              <Controller
                name="customerReplyAttachmentsEnabled"
                control={attachmentForm.control}
                render={({ field }) => (
                  <Switch
                    checked={field.value}
                    onChange={(_, checked) => field.onChange(checked)}
                  />
                )}
              />
            }
            label="允许客户在服务请求回复中添加附件 / 粘贴图片"
          />
          <Stack direction="row" spacing={1.5} sx={{ justifyContent: "flex-end" }}>
            <Button type="submit" variant="contained" disabled={attachmentForm.formState.isSubmitting}>
              {attachmentForm.formState.isSubmitting ? "保存中" : "保存附件策略"}
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
        <MailMessageGrid
          rows={messages}
          asOf={mailOutboxSummary.asOf}
          messageAction={messageAction}
          onView={setSelectedMessage}
          onRetry={retryMessage}
          onCancel={cancelMessage}
        />
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
