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
import { listRoleGroups } from "@/modules/users/role-group-service";

export const metadata = {
  title: "平台设置",
};

export default async function StaffSettingsPage() {
  const { actor } = await requireUserWithAccess();
  if (!actor.isPlatformAdmin) {
    redirect("/staff/projects");
  }

  const [settings, messages, roleGroups] = await Promise.all([
    getPlatformSettings(actor),
    listMailMessages(actor, 50),
    listRoleGroups(actor),
  ]);

  const settingsView: PlatformSettingsView = {
    appUrl: settings.appUrl,
    mailMode: settings.mailMode,
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
    subject: message.subject,
    heading: message.heading,
    body: message.body,
    actionLabel: message.actionLabel,
    actionUrl: message.actionUrl,
    status: message.status,
    errorMessage: message.errorMessage,
    providerId: message.providerId,
    sentAt: message.sentAt?.toISOString() ?? null,
    createdAt: message.createdAt.toISOString(),
  }));

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
        <StaffPageHeading
          title="平台设置"
          description="按模块配置角色、站点邮件、附件策略与发件箱"
        />

        <Accordion disableGutters elevation={0} sx={{ border: "1px solid", borderColor: "divider", borderRadius: "10px !important", overflow: "hidden", "&:before": { display: "none" } }}>
          <AccordionSummary expandIcon={<ExpandMoreOutlinedIcon />}>
            <Stack spacing={0.5}>
              <Typography sx={{ fontWeight: 700 }}>1. 角色组与权限</Typography>
              <Typography variant="body2" color="text.secondary">
                配置外包/协作角色，平台管理员固定保留
              </Typography>
            </Stack>
          </AccordionSummary>
          <AccordionDetails sx={{ pt: 0 }}>
            <RoleGroupManager roleGroups={roleGroupViews} />
          </AccordionDetails>
        </Accordion>

        <Accordion disableGutters elevation={0} sx={{ border: "1px solid", borderColor: "divider", borderRadius: "10px !important", overflow: "hidden", "&:before": { display: "none" } }}>
          <AccordionSummary expandIcon={<ExpandMoreOutlinedIcon />}>
            <Stack spacing={0.5}>
              <Typography sx={{ fontWeight: 700 }}>2. 站点与邮件</Typography>
              <Typography variant="body2" color="text.secondary">
                站点地址与 SMTP 外发
              </Typography>
            </Stack>
          </AccordionSummary>
          <AccordionDetails sx={{ pt: 0 }}>
            <PlatformSettingsManager
              initialSettings={settingsView}
              initialMessages={messageViews}
              sections={["site-mail"]}
            />
          </AccordionDetails>
        </Accordion>

        <Accordion disableGutters elevation={0} sx={{ border: "1px solid", borderColor: "divider", borderRadius: "10px !important", overflow: "hidden", "&:before": { display: "none" } }}>
          <AccordionSummary expandIcon={<ExpandMoreOutlinedIcon />}>
            <Stack spacing={0.5}>
              <Typography sx={{ fontWeight: 700 }}>3. 附件策略</Typography>
              <Typography variant="body2" color="text.secondary">
                文件大小、后缀与客户回复附件权限
              </Typography>
            </Stack>
          </AccordionSummary>
          <AccordionDetails sx={{ pt: 0 }}>
            <PlatformSettingsManager
              initialSettings={settingsView}
              initialMessages={messageViews}
              sections={["attachments"]}
            />
          </AccordionDetails>
        </Accordion>

        <Accordion disableGutters elevation={0} sx={{ border: "1px solid", borderColor: "divider", borderRadius: "10px !important", overflow: "hidden", "&:before": { display: "none" } }}>
          <AccordionSummary expandIcon={<ExpandMoreOutlinedIcon />}>
            <Stack spacing={0.5}>
              <Typography sx={{ fontWeight: 700 }}>4. 发件箱</Typography>
              <Typography variant="body2" color="text.secondary">
                查看邀请与通知发送记录
              </Typography>
            </Stack>
          </AccordionSummary>
          <AccordionDetails sx={{ pt: 0 }}>
            <PlatformSettingsManager
              initialSettings={settingsView}
              initialMessages={messageViews}
              sections={["outbox"]}
            />
          </AccordionDetails>
        </Accordion>
      </Stack>
    </Container>
  );
}
