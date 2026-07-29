import { Container, Stack } from "@mui/material";
import {
  type MailMessageView,
  type MailOutboxSummary,
  type MailTemplateView,
  type PlatformSettingsView,
} from "@/components/staff/platform-settings-types";
import { SettingsWorkspace } from "@/components/staff/settings-workspace";
import type { NotificationDeliveryRuleView } from "@/modules/notifications/notification-delivery-rules";
import type { ServiceTypeItem } from "@/components/staff/staff-types";
import { StaffPageHeading } from "@/components/staff/staff-page-heading";
import { requirePlatformAdmin } from "@/lib/session";
import {
  getPlatformSettings,
  getMailOutboxSummary,
  listMailMessages,
} from "@/modules/platform-settings/platform-setting-service";
import { listMailTemplates } from "@/modules/platform-settings/mail-template-service";
import { listNotificationDeliveryRules } from "@/modules/notifications/notification-delivery-rule-service";
import { listPluginViews } from "@/modules/plugins/plugin-service";
import { listServiceTypes } from "@/modules/projects/service-type-service";
import { listSupportPlaybooksForAdmin } from "@/modules/requests/support-playbook-service";

export const metadata = {
  title: "设置",
};

export default async function StaffSettingsPage() {
  const { actor } = await requirePlatformAdmin();

  const [settings, messages, mailSummary, notificationRules, templates, plugins, serviceTypesRaw, playbooks] = await Promise.all([
    getPlatformSettings(actor),
    listMailMessages(actor, 50),
    getMailOutboxSummary(actor),
    listNotificationDeliveryRules(actor),
    listMailTemplates(actor),
    listPluginViews(actor),
    listServiceTypes(actor),
    listSupportPlaybooksForAdmin(actor),
  ]);
  const dingTalkPlugin = plugins.find((plugin) => plugin.key === "dingtalk-robot");

  const settingsView: PlatformSettingsView = {
    appUrl: settings.appUrl,
    mailMode: settings.mailMode,
    mailFrom: settings.mailFrom,
    hasDedicatedEncryptionKey: settings.hasDedicatedEncryptionKey,
    hasResendApiKey: settings.hasResendApiKey,
    resendDomain: settings.resendDomain,
    resendDomainId: settings.resendDomainId,
    resendDomainStatus: settings.resendDomainStatus,
    resendDnsRecords: settings.resendDnsRecords,
    resendWebhookId: settings.resendWebhookId,
    resendWebhookStatus: settings.resendWebhookStatus,
    hasResendWebhookSecret: settings.hasResendWebhookSecret,
    resendLastCheckedAt: settings.resendLastCheckedAt,
    smtpHost: settings.smtpHost,
    smtpPort: settings.smtpPort,
    smtpUser: settings.smtpUser,
    smtpFrom: settings.smtpFrom,
    smtpSecure: settings.smtpSecure,
    hasStoredPassword: settings.hasStoredPassword,
    smtpHealthStatus:
      settings.smtpHealthStatus === "healthy" ||
      settings.smtpHealthStatus === "error" ||
      settings.smtpHealthStatus === "unchecked"
        ? settings.smtpHealthStatus
        : null,
    smtpLastCheckedAt: settings.smtpLastCheckedAt,
    smtpLastError: settings.smtpLastError,
    attachmentMaxSizeMb: settings.attachmentMaxSizeMb,
    attachmentAllowedExtensions: settings.attachmentAllowedExtensions,
    customerReplyAttachmentsEnabled: settings.customerReplyAttachmentsEnabled,
    standardEmailUnreadDelayEnabled:
      settings.standardEmailUnreadDelayEnabled,
    emailOtpLoginEnabled: settings.emailOtpLoginEnabled,
    updatedAt: settings.updatedAt,
  };

  const messageViews: MailMessageView[] = messages.map((message) => ({
    id: message.id,
    toEmail: message.toEmail,
    templateKey: message.templateKey,
    subject: message.subject,
    previewText: message.previewText,
    heading: message.heading,
    body: message.body,
    actionLabel: message.actionLabel,
    actionUrl: message.actionUrl,
    deliveryMode: message.deliveryMode,
    status: message.status,
    errorMessage: message.errorMessage,
    attemptCount: message.attemptCount,
    lastAttemptAt: message.lastAttemptAt?.toISOString() ?? null,
    providerId: message.providerId,
    sentAt: message.sentAt?.toISOString() ?? null,
    lastEventAt: message.lastEventAt?.toISOString() ?? null,
    sendAfter: message.sendAfter.toISOString(),
    createdAt: message.createdAt.toISOString(),
  }));
  const mailOutboxSummary: MailOutboxSummary = mailSummary;
  const notificationRuleViews: NotificationDeliveryRuleView[] = notificationRules;
  const templateViews: MailTemplateView[] = templates;
  const serviceTypes: ServiceTypeItem[] = serviceTypesRaw.map((serviceType) => ({
    id: serviceType.id,
    key: serviceType.key,
    name: serviceType.name,
    description: serviceType.description,
    active: serviceType.active,
    updatedAt: serviceType.updatedAt.toISOString(),
    categories: serviceType.requestCategories.map((category) => ({
      id: category.id,
      name: category.name,
      description: category.description,
      active: category.active,
    })),
  }));

  return (
    <Container
      maxWidth={false}
      sx={{ px: { xs: 2, md: 3.5 }, py: { xs: 3, md: 4 } }}
    >
      <Stack spacing={3}>
        <StaffPageHeading title="设置" />
        <SettingsWorkspace
          initialSettings={settingsView}
          initialMessages={messageViews}
          initialMailOutboxSummary={mailOutboxSummary}
          initialNotificationRules={notificationRuleViews}
          initialTemplates={templateViews}
          currentAdminEmail={actor.email}
          dingTalkPluginEnabled={dingTalkPlugin?.enabled === true}
          dingTalkPluginReady={dingTalkPlugin?.healthStatus === "READY"}
          serviceTypes={serviceTypes}
          playbooks={playbooks}
        />
      </Stack>
    </Container>
  );
}
