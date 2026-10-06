import { Stack } from "@mui/material";
import { PageContainer } from "@/components/shared/page-container";
import { StaffPageHeading } from "@/components/staff/staff-page-heading";
import { SystemErrorWorkspace } from "@/components/staff/system-error-workspace";
import { requirePlatformAdmin } from "@/lib/session";

export const metadata = {
  title: "系统报错",
};

export default async function StaffSystemErrorsPage() {
  await requirePlatformAdmin();

  return (
    <PageContainer>
      <Stack spacing={3}>
        <StaffPageHeading
          title="系统报错"
          description="接口和后台任务的意外报错，用户提示里的「错误编号」可直接搜索；仅平台管理员可见。"
        />
        <SystemErrorWorkspace />
      </Stack>
    </PageContainer>
  );
}
