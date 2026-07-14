import { Container, Stack } from "@mui/material";
import { PageHeading } from "@/components/customer/page-heading";
import { ProfileSettingsForm } from "@/components/shared/profile-settings-form";
import { prisma } from "@/lib/db";
import { requireUserWithAccess } from "@/lib/session";

export const metadata = {
  title: "个人设置",
};

export default async function CustomerAccountPage() {
  const { session, actor } = await requireUserWithAccess();
  const profile = await prisma.user.findUnique({
    where: { id: actor.id },
    select: { image: true, name: true },
  });

  return (
    <Container
      maxWidth={false}
      sx={{ px: { xs: 2, md: 3.5 }, py: { xs: 3, md: 4 } }}
    >
      <Stack spacing={3}>
        <PageHeading
          title="个人设置"
          description="管理显示名称与头像"
        />
        <ProfileSettingsForm
          user={{
            id: actor.id,
            name: profile?.name ?? actor.name,
            email: actor.email,
            image: profile?.image ?? session.user.image,
          }}
        />
      </Stack>
    </Container>
  );
}
