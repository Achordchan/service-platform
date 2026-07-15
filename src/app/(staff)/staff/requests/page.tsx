import { Container, Stack } from "@mui/material";
import { RequestTable } from "@/components/staff/request-table";
import { RealtimeRouteRefresh } from "@/components/shared/realtime-route-refresh";
import { StaffPageHeading } from "@/components/staff/staff-page-heading";
import type { RequestListItem } from "@/components/staff/staff-types";
import { requireUserWithAccess } from "@/lib/session";
import { listProjects } from "@/modules/projects/project-service";
import { listProjectRequests } from "@/modules/requests/request-service";

export const metadata = {
  title: "服务请求",
};

export default async function StaffRequestsPage() {
  const { actor } = await requireUserWithAccess();
  const projects = await listProjects(actor);
  const groups = await Promise.all(
    projects.map(async (project) => ({
      project,
      requests: await listProjectRequests(actor, project.id),
    })),
  );
  const requests: RequestListItem[] = groups
    .flatMap(({ project, requests: projectRequests }) => {
      if (!project.customerSpace || !project.serviceType) {
        return [];
      }
      return projectRequests
        .filter((request) => request.category && request.createdBy)
        .map((request) => ({
          id: request.id,
          number: request.number,
          title: request.title,
          description: request.description,
          priority: request.priority,
          status: request.status,
          createdAt: request.createdAt.toISOString(),
          updatedAt: request.updatedAt.toISOString(),
          projectId: project.id,
          projectTitle: project.title,
          customerName: project.customerSpace.name,
          serviceTypeName: project.serviceType.name,
          categoryName: request.category.name,
          assigneeId: request.assigneeId,
          assigneeName:
            (request.assignees.length
              ? request.assignees.map((item) => item.user.name).join("、")
              : request.assignee?.name) ?? null,
          createdByName: request.createdBy.name,
        }));
    })
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  return (
    <Container
      maxWidth={false}
      sx={{ px: { xs: 2, md: 3.5 }, py: { xs: 3, md: 4 } }}
    >
      <Stack spacing={3}>
        <RealtimeRouteRefresh mode="request-list" />
        <StaffPageHeading title="服务请求" />
        <RequestTable requests={requests} />
      </Stack>
    </Container>
  );
}
