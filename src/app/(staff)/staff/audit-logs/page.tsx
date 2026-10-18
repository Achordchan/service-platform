import { Stack } from "@mui/material";
import { PageContainer } from "@/components/shared/page-container";
import { AuditLogWorkspace } from "@/components/staff/audit-log-workspace";
import { StaffPageHeading } from "@/components/staff/staff-page-heading";
import { requirePlatformAdmin } from "@/lib/session";

export const metadata = {
  title: "审计日志",
};

export default async function StaffAuditLogsPage() {
  await requirePlatformAdmin();

  return (
    <PageContainer>
      <Stack spacing={3}>
        <StaffPageHeading
          title="审计日志"
          description="谁在什么时候登录、停留了多久、做了哪些操作。默认只看人话摘要，操作码、IP、User-Agent 等排查信息收在详情里。"
        />
        <AuditLogWorkspace />
      </Stack>
    </PageContainer>
  );
}
