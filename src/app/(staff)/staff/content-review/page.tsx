import { redirect } from "next/navigation";
import { Container, Stack } from "@mui/material";
import { ContentReviewWorkspace } from "@/components/staff/content-review-workspace";
import { StaffPageHeading } from "@/components/staff/staff-page-heading";
import { requirePlatformAdmin } from "@/lib/session";
import { getPluginView } from "@/modules/plugins/plugin-service";

export const metadata = {
  title: "内容审核",
};

export default async function StaffContentReviewPage() {
  const { actor } = await requirePlatformAdmin();
  const plugin = await getPluginView(actor, "content-contact-risk");
  if (!plugin.enabled) {
    redirect("/staff/plugins");
  }

  return (
    <Container
      maxWidth={false}
      sx={{ px: { xs: 2, md: 3.5 }, py: { xs: 3, md: 4 } }}
    >
      <Stack spacing={3}>
        <StaffPageHeading title="内容审核" />
        <ContentReviewWorkspace />
      </Stack>
    </Container>
  );
}
