import { PageContainer } from "@/components/shared/page-container";
import type { ServiceRequestSummary } from "@/components/customer/customer-types";
import { ServiceRequestList } from "@/components/customer/service-request-list";
import { RealtimeRouteRefresh } from "@/components/shared/realtime-route-refresh";
import { requireUserWithAccess } from "@/lib/session";
import { listProjects } from "@/modules/projects/project-service";
import { listProjectRequests } from "@/modules/requests/request-service";

export const metadata = {
  title: "服务请求",
};

export default async function CustomerRequestsPage() {
  const { actor } = await requireUserWithAccess();
  const projects = (await listProjects(actor)).filter(
    (project) => project.customerRequestsEnabled !== false,
  );
  const requestGroups = await Promise.all(
    projects.map(async (project) => ({
      project,
      requests: await listProjectRequests(actor, project.id),
    })),
  );

  const requests: ServiceRequestSummary[] = requestGroups
    .flatMap(({ project, requests: projectRequests }) =>
      projectRequests.map((request) => ({
        id: request.id,
        number: request.number,
        title: request.title,
        description: request.description,
        priority: request.priority,
        status: request.status,
        archivedAt: request.archivedAt?.toISOString() ?? null,
        createdAt: request.createdAt.toISOString(),
        updatedAt: request.updatedAt.toISOString(),
        projectId: project.id,
        projectTitle: project.title,
        serviceTypeName: project.serviceType.name,
        category: request.category,
        assigneeName:
          (request.assignees.length
            ? request.assignees.map((item) => item.user.name).join("、")
            : request.assignee?.name) ?? null,
      })),
    )
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  return (
    <PageContainer>
      <RealtimeRouteRefresh mode="request-list" />
      <ServiceRequestList requests={requests} showHeading />
    </PageContainer>
  );
}
