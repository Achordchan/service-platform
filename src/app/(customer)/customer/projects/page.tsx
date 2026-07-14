import { Container, Stack, Typography } from "@mui/material";
import type { ProjectSummary } from "@/components/customer/customer-types";
import { PageHeading } from "@/components/customer/page-heading";
import { ProjectList } from "@/components/customer/project-list";
import { EmptyState } from "@/components/shared/content-state";
import { requireUserWithAccess } from "@/lib/session";
import { listProjects } from "@/modules/projects/project-service";

export const metadata = {
  title: "我的服务",
};

export default async function CustomerProjectsPage() {
  const { actor } = await requireUserWithAccess();
  const result = await listProjects(actor);
  const projects: ProjectSummary[] = result.map((project) => ({
    id: project.id,
    title: project.title,
    description: project.description,
    status: project.status,
    currentStage: project.currentStage,
    showMilestones: project.showMilestones,
    showProgress: project.showProgress,
    startDate: project.startDate?.toISOString() ?? null,
    endDate: project.endDate?.toISOString() ?? null,
    updatedAt: project.updatedAt.toISOString(),
    progress: project.progress,
    serviceType: {
      id: project.serviceType.id,
      name: project.serviceType.name,
    },
    customerSpace: {
      id: project.customerSpace.id,
      name: project.customerSpace.name,
    },
    requestCount: project._count.requests,
    updateCount: project._count.updates,
  }));

  return (
    <Container
      maxWidth={false}
      sx={{ px: { xs: 2, md: 5 }, py: { xs: 3, md: 5 } }}
    >
      <Stack spacing={4}>
        <PageHeading
          title="我的服务"
          description="查看服务周期、项目进度和交付动态"
          actionLabel="提交服务请求"
          actionHref="/customer/requests/new"
        />
        {projects.length > 0 ? (
          <>
            <Typography variant="body2" color="text.secondary">
              共 {projects.length} 个服务项目
            </Typography>
            <ProjectList projects={projects} />
          </>
        ) : (
          <EmptyState
            title="暂无服务项目"
            description="服务项目开通后，将在这里展示进度、里程碑和服务请求。"
          />
        )}
      </Stack>
    </Container>
  );
}
