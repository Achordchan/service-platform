import { redirect } from "next/navigation";
import { Container, Stack } from "@mui/material";
import { PluginCenter } from "@/components/staff/plugin-center";
import { StaffPageHeading } from "@/components/staff/staff-page-heading";
import { requireUserWithAccess } from "@/lib/session";
import { listPluginViews } from "@/modules/plugins/plugin-service";

export const metadata = {
  title: "插件中心",
};

export default async function StaffPluginsPage() {
  const { actor } = await requireUserWithAccess();
  if (!actor.isPlatformAdmin) {
    redirect("/staff/projects");
  }
  const plugins = await listPluginViews(actor);

  return (
    <Container
      maxWidth={false}
      sx={{ px: { xs: 2, md: 3.5 }, py: { xs: 3, md: 4 } }}
    >
      <Stack spacing={3}>
        <StaffPageHeading
          title="插件中心"
          description="统一查看平台已安装的扩展功能"
        />
        <PluginCenter plugins={plugins} />
      </Stack>
    </Container>
  );
}
