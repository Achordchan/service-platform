import { Container, Stack } from "@mui/material";
import type { ProjectSummary } from "@/components/customer/customer-types";
import { PageHeading } from "@/components/customer/page-heading";
import { ProjectList } from "@/components/customer/project-list";
import { EmptyState } from "@/components/shared/content-state";
import { RealtimeRouteRefresh } from "@/components/shared/realtime-route-refresh";
import { requireUserWithAccess } from "@/lib/session";
import { listProjects } from "@/modules/projects/project-service";

export const metadata = {
  title: "服务项目",
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
    customerUpdatesEnabled: project.customerUpdatesEnabled,
    customerRequestsEnabled: project.customerRequestsEnabled,
    customerFilesEnabled: project.customerFilesEnabled,
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
    managerNames: project.staff.map((member) => member.user.name),
    requestCount: project._count.requests,
    updateCount: project._count.updates,
  }));

  return (
    <Container
      maxWidth={false}
      sx={{ px: { xs: 2, md: 5 }, py: { xs: 3, md: 5 } }}
    >
      <Stack spacing={4}>
        <RealtimeRouteRefresh mode="project-list" />
        <PageHeading
          title="服务项目"
          actionLabel="提交服务请求"
          actionHref="/customer/requests/new"
        />
        {projects.length > 0 ? (
          <ProjectList projects={projects} />
        ) : (
          <EmptyState
            title="暂无服务项目"
            description="项目开通后将在此显示。"
          />
        )}
      </Stack>
    </Container>
  );
}
