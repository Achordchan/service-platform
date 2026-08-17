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
          description="平台上所有敏感操作的完整记录，仅平台管理员可见。"
        />
        <AuditLogWorkspace />
      </Stack>
    </PageContainer>
  );
}
