"use client";

import { useState } from "react";
import {
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Paper,
  Stack,
  Typography,
} from "@mui/material";
import { MailSettingsPanel } from "@/components/staff/mail-settings-panel";
import { MailTemplateManager } from "@/components/staff/mail-template-manager";
import { PlatformSettingsManager } from "@/components/staff/platform-settings-manager";
import type {
  MailMessageView,
  MailTemplateView,
  PlatformSettingsView,
} from "@/components/staff/platform-settings-types";
import {
  RoleGroupManager,
  type RoleGroupView,
} from "@/components/staff/role-group-manager";

type SettingsDialog = "mail" | "attachments" | "outbox" | null;

function SettingsRow({
  title,
  summary,
  status,
  actionLabel = "管理",
  onClick,
}: {
  title: string;
  summary: string;
  status?: React.ReactNode;
  actionLabel?: string;
  onClick: () => void;
}) {
  return (
    <Stack
      direction={{ xs: "column", sm: "row" }}
      spacing={2}
      sx={{
        px: { xs: 2, sm: 2.5 },
        py: 2.25,
        alignItems: { sm: "center" },
        justifyContent: "space-between",
      }}
    >
      <Box sx={{ minWidth: 0 }}>
        <Stack
          direction="row"
          spacing={1}
          useFlexGap
          sx={{ alignItems: "center", flexWrap: "wrap" }}
        >
          <Typography sx={{ fontWeight: 700 }}>{title}</Typography>
          {status}
        </Stack>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          {summary}
        </Typography>
      </Box>
      <Button
        variant="outlined"
        onClick={onClick}
        sx={{ alignSelf: { xs: "stretch", sm: "center" }, flexShrink: 0 }}
      >
        {actionLabel}
      </Button>
    </Stack>
  );
}

export function PlatformSettingsHub({
  initialSettings,
  initialMessages,
  initialTemplates,
  roleGroups,
  currentAdminEmail,
}: {
  initialSettings: PlatformSettingsView;
  initialMessages: MailMessageView[];
  initialTemplates: MailTemplateView[];
  roleGroups: RoleGroupView[];
  currentAdminEmail: string;
}) {
  const [settings, setSettings] = useState(initialSettings);
  const [dialog, setDialog] = useState<SettingsDialog>(null);
  const resendReady =
    settings.hasResendApiKey &&
    settings.resendDomainStatus === "verified" &&
    settings.resendWebhookStatus === "enabled" &&
    settings.hasResendWebhookSecret;
  const dialogTitle = {
    mail: "邮件设置",
    attachments: "附件",
    outbox: "发件箱",
  } as const;

  return (
    <Stack spacing={3}>
      <Paper variant="outlined" sx={{ overflow: "hidden" }}>
        <SettingsRow
          title="邮件"
          summary={
            resendReady
              ? `${settings.resendDomain} · ${settings.mailFrom}`
              : "尚未完成邮件服务配置"
          }
          status={
            <Chip
              size="small"
              label={
                settings.mailMode === "RESEND"
                  ? "运行中"
                  : settings.mailMode === "SMTP"
                    ? "SMTP"
                    : "本地"
              }
              color={settings.mailMode === "RESEND" ? "success" : "default"}
            />
          }
          onClick={() => setDialog("mail")}
        />
        <Divider />
        <SettingsRow
          title="附件"
          summary={`单文件 ${settings.attachmentMaxSizeMb}MB · ${
            settings.customerReplyAttachmentsEnabled
              ? "客户可上传"
              : "仅员工可上传"
          }`}
          onClick={() => setDialog("attachments")}
        />
        <Divider />
        <SettingsRow
          title="发件箱"
          summary={`最近 ${initialMessages.length} 条发送记录`}
          actionLabel="查看"
          onClick={() => setDialog("outbox")}
        />
      </Paper>

      <MailTemplateManager
        initialTemplates={initialTemplates}
        currentAdminEmail={currentAdminEmail}
      />
      <RoleGroupManager roleGroups={roleGroups} showHeading />

      <Dialog
        open={dialog !== null}
        onClose={() => setDialog(null)}
        fullWidth
        maxWidth={dialog === "outbox" ? "lg" : "md"}
        scroll="paper"
      >
        <DialogTitle>
          {dialog ? dialogTitle[dialog] : ""}
        </DialogTitle>
        <DialogContent dividers>
          {dialog === "mail" ? (
            <MailSettingsPanel
              settings={settings}
              currentAdminEmail={currentAdminEmail}
              onSettingsChange={setSettings}
              embedded
            />
          ) : null}
          {dialog === "attachments" ? (
            <PlatformSettingsManager
              initialSettings={settings}
              initialMessages={initialMessages}
              currentAdminEmail={currentAdminEmail}
              sections={["attachments"]}
              embedded
              onSettingsChange={setSettings}
            />
          ) : null}
          {dialog === "outbox" ? (
            <PlatformSettingsManager
              initialSettings={settings}
              initialMessages={initialMessages}
              currentAdminEmail={currentAdminEmail}
              sections={["outbox"]}
              embedded
            />
          ) : null}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialog(null)}>关闭</Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
