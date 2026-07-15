import { redirect } from "next/navigation";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Container,
  Stack,
  Typography,
} from "@mui/material";
import ExpandMoreOutlinedIcon from "@mui/icons-material/ExpandMoreOutlined";
import {
  PlatformSettingsManager,
  type MailMessageView,
  type PlatformSettingsView,
} from "@/components/staff/platform-settings-manager";
import { MailTemplateManager } from "@/components/staff/mail-template-manager";
import type { MailTemplateView } from "@/components/staff/platform-settings-types";
import {
  RoleGroupManager,
  type RoleGroupView,
} from "@/components/staff/role-group-manager";
import { StaffPageHeading } from "@/components/staff/staff-page-heading";
import { requireUserWithAccess } from "@/lib/session";
import {
  getPlatformSettings,
  listMailMessages,
} from "@/modules/platform-settings/platform-setting-service";
import { listMailTemplates } from "@/modules/platform-settings/mail-template-service";
import { listRoleGroups } from "@/modules/users/role-group-service";

export const metadata = {
  title: "设置",
};

export default async function StaffSettingsPage() {
  const { actor } = await requireUserWithAccess();
  if (!actor.isPlatformAdmin) {
    redirect("/staff/projects");
  }

  const [settings, messages, roleGroups, templates] = await Promise.all([
    getPlatformSettings(actor),
    listMailMessages(actor, 50),
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
    attachmentMaxSizeMb: settings.attachmentMaxSizeMb,
    attachmentAllowedExtensions: settings.attachmentAllowedExtensions,
    customerReplyAttachmentsEnabled: settings.customerReplyAttachmentsEnabled,
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
    createdAt: message.createdAt.toISOString(),
  }));
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

        <Accordion disableGutters elevation={0} sx={{ border: "1px solid", borderColor: "divider", borderRadius: "10px !important", overflow: "hidden", "&:before": { display: "none" } }}>
          <AccordionSummary expandIcon={<ExpandMoreOutlinedIcon />}>
            <Typography sx={{ fontWeight: 700 }}>角色与权限</Typography>
          </AccordionSummary>
          <AccordionDetails sx={{ pt: 0 }}>
            <RoleGroupManager roleGroups={roleGroupViews} />
          </AccordionDetails>
        </Accordion>

        <Accordion disableGutters elevation={0} sx={{ border: "1px solid", borderColor: "divider", borderRadius: "10px !important", overflow: "hidden", "&:before": { display: "none" } }}>
          <AccordionSummary expandIcon={<ExpandMoreOutlinedIcon />}>
            <Typography sx={{ fontWeight: 700 }}>邮件设置</Typography>
          </AccordionSummary>
          <AccordionDetails sx={{ pt: 0 }}>
            <PlatformSettingsManager
              initialSettings={settingsView}
              initialMessages={messageViews}
              currentAdminEmail={actor.email}
              sections={["site-mail"]}
            />
          </AccordionDetails>
        </Accordion>

        <Accordion disableGutters elevation={0} sx={{ border: "1px solid", borderColor: "divider", borderRadius: "10px !important", overflow: "hidden", "&:before": { display: "none" } }}>
          <AccordionSummary expandIcon={<ExpandMoreOutlinedIcon />}>
            <Typography sx={{ fontWeight: 700 }}>邮件模板</Typography>
          </AccordionSummary>
          <AccordionDetails sx={{ pt: 0 }}>
            <MailTemplateManager
              initialTemplates={templateViews}
              currentAdminEmail={actor.email}
            />
          </AccordionDetails>
        </Accordion>

        <Accordion disableGutters elevation={0} sx={{ border: "1px solid", borderColor: "divider", borderRadius: "10px !important", overflow: "hidden", "&:before": { display: "none" } }}>
          <AccordionSummary expandIcon={<ExpandMoreOutlinedIcon />}>
            <Typography sx={{ fontWeight: 700 }}>附件</Typography>
          </AccordionSummary>
          <AccordionDetails sx={{ pt: 0 }}>
            <PlatformSettingsManager
              initialSettings={settingsView}
              initialMessages={messageViews}
              currentAdminEmail={actor.email}
              sections={["attachments"]}
            />
          </AccordionDetails>
        </Accordion>

        <Accordion disableGutters elevation={0} sx={{ border: "1px solid", borderColor: "divider", borderRadius: "10px !important", overflow: "hidden", "&:before": { display: "none" } }}>
          <AccordionSummary expandIcon={<ExpandMoreOutlinedIcon />}>
            <Typography sx={{ fontWeight: 700 }}>发件箱</Typography>
          </AccordionSummary>
          <AccordionDetails sx={{ pt: 0 }}>
            <PlatformSettingsManager
              initialSettings={settingsView}
              initialMessages={messageViews}
              currentAdminEmail={actor.email}
              sections={["outbox"]}
            />
          </AccordionDetails>
        </Accordion>
      </Stack>
    </Container>
  );
}
