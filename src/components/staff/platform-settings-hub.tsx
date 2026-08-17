"use client";

import { useState } from "react";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
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
import ExpandMoreOutlinedIcon from "@mui/icons-material/ExpandMoreOutlined";
import { MailSettingsPanel } from "@/components/staff/mail-settings-panel";
import { MailTemplateManager } from "@/components/staff/mail-template-manager";
import { PlatformSettingsManager } from "@/components/staff/platform-settings-manager";
import {
  NotificationDeliveryRulesPanel,
  type NotificationDeliveryRuleView,
} from "@/components/staff/notification-delivery-rules-panel";
import type {
  MailMessageView,
  MailOutboxSummary,
  MailTemplateView,
  PlatformSettingsView,
} from "@/components/staff/platform-settings-types";

type SettingsDialog = "mail" | "notifications" | "attachments" | "outbox" | null;

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
          <Typography sx={{ fontWeight: 650 }}>{title}</Typography>
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

function SettingsDisclosure({
  title,
  summary,
  expanded,
  padded = false,
  onChange,
  children,
}: {
  title: string;
  summary: string;
  expanded: boolean;
  padded?: boolean;
  onChange: (expanded: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <Accordion
      expanded={expanded}
      onChange={(_event, nextExpanded) => onChange(nextExpanded)}
      disableGutters
      variant="outlined"
      sx={{
        overflow: "hidden",
        "&:before": { display: "none" },
      }}
    >
      <AccordionSummary
        expandIcon={<ExpandMoreOutlinedIcon />}
        sx={{
          px: { xs: 2, sm: 2.5 },
          py: 0.5,
          "& .MuiAccordionSummary-content": { my: 1.75 },
        }}
      >
        <Box sx={{ minWidth: 0 }}>
          <Typography sx={{ fontWeight: 650 }}>{title}</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            {summary}
          </Typography>
        </Box>
      </AccordionSummary>
      {expanded ? (
        <AccordionDetails
          sx={{
            p: padded ? { xs: 2, sm: 2.5 } : 0,
            borderTop: 1,
            borderColor: "divider",
          }}
        >
          {children}
        </AccordionDetails>
      ) : null}
    </Accordion>
  );
}

export function PlatformSettingsHub({
  initialSettings,
  initialMessages,
  initialMailOutboxSummary,
  initialNotificationRules,
  initialTemplates,
  currentAdminEmail,
  dingTalkPluginEnabled,
  dingTalkPluginReady,
}: {
  initialSettings: PlatformSettingsView;
  initialMessages: MailMessageView[];
  initialMailOutboxSummary: MailOutboxSummary;
  initialNotificationRules: NotificationDeliveryRuleView[];
  initialTemplates: MailTemplateView[];
  currentAdminEmail: string;
  dingTalkPluginEnabled: boolean;
  dingTalkPluginReady: boolean;
}) {
  const [settings, setSettings] = useState(initialSettings);
  const [mailOutboxSummary, setMailOutboxSummary] = useState(
    initialMailOutboxSummary,
  );
  const [notificationRules, setNotificationRules] = useState(
    initialNotificationRules,
  );
  const [dialog, setDialog] = useState<SettingsDialog>(null);
  const [expandedTemplates, setExpandedTemplates] = useState(false);
  const resendReady =
    settings.hasResendApiKey &&
    settings.resendDomainStatus === "verified" &&
    settings.resendWebhookStatus === "enabled" &&
    settings.hasResendWebhookSecret;
  const mailEnabled = settings.mailMode !== "LOCAL_OUTBOX";
  const notificationChannels = [
    "通知红点",
    "页面提示音",
    ...(mailEnabled ? ["邮件"] : []),
    ...(dingTalkPluginEnabled ? ["钉钉机器人"] : []),
  ];
  const dialogTitle = {
    mail: "邮件设置",
    notifications: "通知规则",
    attachments: "附件",
    outbox: "发件箱",
  } as const;

  return (
    <Stack spacing={3}>
      <Paper variant="outlined" sx={{ overflow: "hidden" }}>
        <SettingsRow
          title="邮件"
          summary={
            settings.mailMode === "RESEND"
              ? `${settings.resendDomain} · ${settings.mailFrom}`
              : resendReady
                ? "Resend 已连接，等待启用"
                : settings.mailMode === "SMTP"
                  ? `${settings.smtpHost ?? "SMTP"} · ${settings.smtpUser ?? "已配置"}`
                  : "邮件发送未启用"
          }
          status={
            <Chip
              size="small"
              label={
                settings.mailMode === "RESEND"
                  ? "运行中"
                  : settings.mailMode === "SMTP"
                    ? "SMTP"
                    : "未启用"
              }
              color={
                settings.mailMode === "RESEND"
                  ? "success"
                  : settings.mailMode === "LOCAL_OUTBOX"
                    ? "warning"
                    : "default"
              }
            />
          }
          onClick={() => setDialog("mail")}
        />
        <Divider />
        <SettingsRow
          title="通知规则"
          summary={`按业务场景控制${notificationChannels.join("、")}`}
          onClick={() => setDialog("notifications")}
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
          summary={`排队 ${mailOutboxSummary.queued} · 逾期 ${mailOutboxSummary.overdue} · 失败 ${mailOutboxSummary.failed}`}
          status={
            mailOutboxSummary.overdue > 0 ? (
              <Chip size="small" color="error" label="存在逾期" />
            ) : undefined
          }
          actionLabel="查看"
          onClick={() => setDialog("outbox")}
        />
      </Paper>

      {mailEnabled ? (
        <SettingsDisclosure
          title="邮件模板"
          summary={`${initialTemplates.length} 个模板`}
          expanded={expandedTemplates}
          onChange={setExpandedTemplates}
        >
          <MailTemplateManager
            initialTemplates={initialTemplates}
            currentAdminEmail={currentAdminEmail}
            embedded
          />
        </SettingsDisclosure>
      ) : null}

      <Dialog
        open={dialog !== null}
        onClose={() => setDialog(null)}
        fullWidth
        maxWidth={dialog === "outbox" || dialog === "notifications" ? "lg" : "md"}
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
              initialMailOutboxSummary={mailOutboxSummary}
              currentAdminEmail={currentAdminEmail}
              sections={["attachments"]}
              embedded
              onSettingsChange={setSettings}
            />
          ) : null}
          {dialog === "notifications" ? (
            <NotificationDeliveryRulesPanel
              initialRules={notificationRules}
              standardEmailUnreadDelayEnabled={
                settings.standardEmailUnreadDelayEnabled
              }
              mailMode={settings.mailMode}
              dingTalkPluginEnabled={dingTalkPluginEnabled}
              dingTalkPluginReady={dingTalkPluginReady}
              onRulesChange={setNotificationRules}
              onUnreadDelayChange={(enabled) =>
                setSettings((current) => ({
                  ...current,
                  standardEmailUnreadDelayEnabled: enabled,
                }))
              }
            />
          ) : null}
          {dialog === "outbox" ? (
            <PlatformSettingsManager
              initialSettings={settings}
              initialMessages={initialMessages}
              initialMailOutboxSummary={mailOutboxSummary}
              currentAdminEmail={currentAdminEmail}
              sections={["outbox"]}
              embedded
              onMailOutboxSummaryChange={setMailOutboxSummary}
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
