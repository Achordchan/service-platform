import { Stack } from "@mui/material";
import { PageContainer } from "@/components/shared/page-container";
import { PluginCenter } from "@/components/staff/plugin-center";
import { StaffPageHeading } from "@/components/staff/staff-page-heading";
import { requirePlatformAdmin } from "@/lib/session";
import { listPluginViews } from "@/modules/plugins/plugin-service";

export const metadata = {
  title: "插件中心",
};

export default async function StaffPluginsPage() {
  const { actor } = await requirePlatformAdmin();
  const plugins = await listPluginViews(actor);

  return (
    <PageContainer>
      <Stack spacing={3}>
        <StaffPageHeading
          title="插件中心"
          description="统一查看平台已安装的扩展功能"
        />
        <PluginCenter plugins={plugins} />
      </Stack>
    </PageContainer>
  );
}
