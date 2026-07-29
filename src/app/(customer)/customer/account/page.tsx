import { Container, Stack } from "@mui/material";
import { PageHeading } from "@/components/customer/page-heading";
import { ProfileSettingsForm } from "@/components/shared/profile-settings-form";
import { NotificationPreferencesForm } from "@/components/shared/notification-preferences-form";
import { prisma } from "@/lib/db";
import { requireUserWithAccess } from "@/lib/session";
import { getPendingUserEmailChange } from "@/modules/users/customer-email-change-service";

export const metadata = {
  title: "个人设置",
};

export default async function CustomerAccountPage() {
  const { session, actor } = await requireUserWithAccess();
  const [profile, pendingEmailChange] = await Promise.all([
    prisma.user.findUnique({
      where: { id: actor.id },
      select: {
        image: true,
        name: true,
        soundNotificationsEnabled: true,
        requestEmailNotificationsEnabled: true,
      },
    }),
    getPendingUserEmailChange(actor, actor.id),
  ]);

  return (
    <Container
      maxWidth={false}
      sx={{ px: { xs: 2, md: 3.5 }, py: { xs: 3, md: 4 } }}
    >
      <Stack spacing={3}>
        <PageHeading title="个人设置" />
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
        <NotificationPreferencesForm
          initialPreferences={{
            soundNotificationsEnabled:
              profile?.soundNotificationsEnabled ?? true,
            requestEmailNotificationsEnabled:
              profile?.requestEmailNotificationsEnabled ?? true,
          }}
        />
      </Stack>
    </Container>
  );
}
