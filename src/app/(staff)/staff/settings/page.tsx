import { redirect } from "next/navigation";
import { Container, Stack } from "@mui/material";
import {
  type MailMessageView,
  type MailOutboxSummary,
  type MailTemplateView,
  type PlatformSettingsView,
} from "@/components/staff/platform-settings-types";
import { PlatformSettingsHub } from "@/components/staff/platform-settings-hub";
import type { NotificationDeliveryRuleView } from "@/modules/notifications/notification-delivery-rules";
import type { RoleGroupView } from "@/components/staff/role-group-manager";
import { StaffPageHeading } from "@/components/staff/staff-page-heading";
import { requireUserWithAccess } from "@/lib/session";
import {
  getPlatformSettings,
  getMailOutboxSummary,
  listMailMessages,
} from "@/modules/platform-settings/platform-setting-service";
import { listMailTemplates } from "@/modules/platform-settings/mail-template-service";
import { listNotificationDeliveryRules } from "@/modules/notifications/notification-delivery-rule-service";
import { listRoleGroups } from "@/modules/users/role-group-service";

export const metadata = {
  title: "设置",
};

export default async function StaffSettingsPage() {
  const { actor } = await requireUserWithAccess();
  if (!actor.isPlatformAdmin) {
    redirect("/staff/projects");
  }

  const [settings, messages, mailSummary, notificationRules, roleGroups, templates] = await Promise.all([
    getPlatformSettings(actor),
    listMailMessages(actor, 50),
    getMailOutboxSummary(actor),
    listNotificationDeliveryRules(actor),
    listRoleGroups(actor),
    listMailTemplates(actor),
  ]);

  const settingsView: PlatformSettingsView = {
    appUrl: settings.appUrl,
    mailMode: settings.mailMode,
    mailFrom: settings.mailFrom,
    mailReplyTo: settings.mailReplyTo,
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
    standardRequestEmailEnabled: settings.standardRequestEmailEnabled,
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

  const roleGroupViews: RoleGroupView[] = roleGroups.map((group) => ({
    id: group.id,
    key: group.key,
    name: group.name,
    description: group.description,
    accessLevel: group.accessLevel,
    permissions: group.permissions,
    isSystem: group.isSystem,
    active: group.active,
    sortOrder: group.sortOrder,
    userCount: group._count.users,
    invitationCount: group._count.invitations,
    updatedAt: group.updatedAt.toISOString(),
  }));

  return (
    <Container
      maxWidth={false}
      sx={{ px: { xs: 2, md: 3.5 }, py: { xs: 3, md: 4 } }}
    >
      <Stack spacing={3}>
        <StaffPageHeading title="设置" />
        <PlatformSettingsHub
          initialSettings={settingsView}
          initialMessages={messageViews}
          initialMailOutboxSummary={mailOutboxSummary}
          initialNotificationRules={notificationRuleViews}
          initialTemplates={templateViews}
          roleGroups={roleGroupViews}
          currentAdminEmail={actor.email}
        />
      </Stack>
    </Container>
  );
}
