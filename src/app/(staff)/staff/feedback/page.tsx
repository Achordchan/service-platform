import { Stack } from "@mui/material";
import { PageContainer } from "@/components/shared/page-container";
import { FeedbackWorkspace } from "@/components/staff/feedback-workspace";
import { StaffPageHeading } from "@/components/staff/staff-page-heading";

export const metadata = {
  title: "用户反馈",
};

export default async function StaffFeedbackPage() {
  return (
    <PageContainer>
      <Stack spacing={3}>
        <StaffPageHeading
          title="用户反馈"
          description="客户与员工从 Web 端和小程序提交的反馈。GitHub issue 仅是同步通道，这里的记录始终完整。"
        />
        <FeedbackWorkspace />
      </Stack>
    </PageContainer>
  );
}
