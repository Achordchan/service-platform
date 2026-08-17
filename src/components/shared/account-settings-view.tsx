import Stack from "@mui/material/Stack";
import { PageContainer } from "@/components/shared/page-container";
import { PasswordChangeForm } from "@/components/shared/password-change-form";
import { ProfileSettingsForm } from "@/components/shared/profile-settings-form";
import { NotificationPreferencesForm } from "@/components/shared/notification-preferences-form";
import { SessionManagementForm } from "@/components/shared/session-management-form";
import {
  AccountSettingsLayout,
  type AccountSettingsSection,
} from "@/components/shared/account-settings-layout";
import { prisma } from "@/lib/db";
import { requireUserWithAccess } from "@/lib/session";
import { getPendingUserEmailChange } from "@/modules/users/customer-email-change-service";
import { getNotificationPreferences } from "@/modules/users/notification-preference-service";

/**
 * The customer and staff 个人设置 pages differ only in which page-heading
 * component they use, so the data loading and layout live here and each route
 * passes its own already-rendered heading element.
 *
 * 布局：左侧分组导航 + 右侧当前分组（GitHub/Stripe 设置页模式），
 * 页面长度恒等于单组内容；?section= 可定位到指定分组。
 */
export async function AccountSettingsView({
  heading,
  initialSection,
}: {
  heading: React.ReactNode;
  initialSection?: string;
}) {
  const { session, actor } = await requireUserWithAccess();
  const [profile, pendingEmailChange, credentialAccount, notificationPreferences] =
    await Promise.all([
      prisma.user.findUnique({
        where: { id: actor.id },
        select: {
          image: true,
          name: true,
        },
      }),
      getPendingUserEmailChange(actor, actor.id),
      prisma.account.findFirst({
        where: { userId: actor.id, providerId: "credential" },
        select: { id: true },
      }),
      getNotificationPreferences(actor),
    ]);

  const sections: AccountSettingsSection[] = [
    {
      key: "profile",
      label: "个人资料",
      description: "头像、姓名与登录邮箱",
      content: (
        <ProfileSettingsForm
          key={pendingEmailChange?.id ?? "no-pending-email-change"}
          user={{
            id: actor.id,
            name: profile?.name ?? actor.name,
            email: actor.email,
            image: profile?.image ?? session.user.image,
          }}
          initialPendingEmailChange={pendingEmailChange}
        />
      ),
    },
    {
      key: "security",
      label: "账号安全",
      description: "定期更新密码，并留意陌生设备的登录会话",
      content: (
        <Stack spacing={2}>
          <PasswordChangeForm hasPassword={Boolean(credentialAccount)} />
          <SessionManagementForm />
        </Stack>
      ),
    },
    {
      key: "notifications",
      label: "通知",
      description: "站内提示音与业务邮件的接收偏好",
      content: (
        <NotificationPreferencesForm
          audience={actor.isStaff ? "STAFF" : "CUSTOMER"}
          initialPreferences={{
            soundNotificationsEnabled:
              notificationPreferences.soundNotificationsEnabled,
            requestEmailNotificationsEnabled:
              notificationPreferences.requestEmailNotificationsEnabled,
          }}
          initialPerType={notificationPreferences.perType}
        />
      ),
    },
  ];

  return (
    <PageContainer maxWidth="md">
      <Stack spacing={3}>
        {heading}
        <AccountSettingsLayout
          initialSection={initialSection}
          sections={sections}
        />
      </Stack>
    </PageContainer>
  );
}
