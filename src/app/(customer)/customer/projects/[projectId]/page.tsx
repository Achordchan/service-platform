import { Box, Container } from "@mui/material";
import type {
  ProjectDetail,
  ServiceRequestSummary,
} from "@/components/customer/customer-types";
import { PageHeading } from "@/components/customer/page-heading";
import { ProjectFiles } from "@/components/customer/project-files";
import { ProjectOverview } from "@/components/customer/project-overview";
import {
  ProjectTabs,
  type ProjectTabKey as TabKey,
} from "@/components/customer/project-tabs";
import { ProjectUpdates } from "@/components/customer/project-updates";
import { ServiceRequestList } from "@/components/customer/service-request-list";
import { StatusIndicator } from "@/components/shared/status-indicator";
import { requireUserWithAccess } from "@/lib/session";
import { getProject } from "@/modules/projects/project-service";
import { listProjectRequests } from "@/modules/requests/request-service";

const validTabs = new Set<TabKey>([
  "overview",
  "updates",
  "requests",
  "files",
]);

function requestSummary(
  request: Awaited<ReturnType<typeof listProjectRequests>>[number],
  project: Awaited<ReturnType<typeof getProject>>,
): ServiceRequestSummary {
  return {
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
    serviceTypeName: project.serviceType.name,
    category: request.category,
    assigneeName:
      (request.assignees.length
        ? request.assignees.map((item) => item.user.name).join("、")
        : request.assignee?.name) ?? null,
  };
}

export default async function CustomerProjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  const { actor } = await requireUserWithAccess();
  const { projectId } = await params;
  const query = await searchParams;
  const requestedTab = Array.isArray(query.tab) ? query.tab[0] : query.tab;
  const activeTab: TabKey =
    requestedTab && validTabs.has(requestedTab as TabKey)
      ? (requestedTab as TabKey)
      : "overview";

  const [project, requestResult] = await Promise.all([
    getProject(actor, projectId),
    listProjectRequests(actor, projectId),
  ]);

  const projectView: ProjectDetail = {
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
    requestCount: requestResult.length,
    updateCount: project.updates.length,
    staff: project.staff.map((member) => ({
      id: member.user.id,
      name: member.user.name,
      role: member.role,
    })),
    milestones: project.milestones.map((milestone) => ({
      id: milestone.id,
      title: milestone.title,
      description: milestone.description,
      status: milestone.status,
      startDate: milestone.startDate?.toISOString() ?? null,
      endDate: milestone.endDate?.toISOString() ?? null,
    })),
    updates: project.updates.map((update) => ({
      id: update.id,
      title: update.title,
      body: update.body,
      authorName: update.author.name,
      createdAt: update.createdAt.toISOString(),
      comments: update.comments.map((comment) => ({
        id: comment.id,
        body: comment.body,
        authorName: comment.author.name,
        createdAt: comment.createdAt.toISOString(),
      })),
    })),
    attachments: project.attachments.map((attachment) => ({
      id: attachment.id,
      originalName: attachment.originalName,
      mimeType: attachment.mimeType,
      size: attachment.size,
      createdAt: attachment.createdAt.toISOString(),
    })),
  };
  const requests = requestResult.map((request) =>
    requestSummary(request, project),
  );

  return (
    <Container
      maxWidth={false}
      sx={{
        width: "100%",
        maxWidth: "100%",
        px: { xs: 2, md: 3.5 },
        py: { xs: 3, md: 4 },
      }}
    >
      <PageHeading
        backLabel="服务项目"
        backHref="/customer/projects"
        title={project.title}
        description={`服务周期：${
          projectView.startDate
            ? new Intl.DateTimeFormat("zh-CN").format(
                new Date(projectView.startDate),
              )
            : "未设置"
        } — ${
          projectView.endDate
            ? new Intl.DateTimeFormat("zh-CN").format(
                new Date(projectView.endDate),
              )
            : "未设置"
        }`}
        actionLabel={activeTab === "requests" ? undefined : "提交服务请求"}
        actionHref={
          activeTab === "requests"
            ? undefined
            : `/customer/requests/new?projectId=${project.id}`
        }
        status={<StatusIndicator status={project.status} />}
      />
      <ProjectTabs
        projectId={project.id}
        activeTab={activeTab}
        requestIds={requests.map((item) => item.id)}
      />
      {activeTab === "overview" ? (
        <ProjectOverview project={projectView} requests={requests} />
      ) : null}
      {activeTab === "updates" ? (
        <Box sx={{ pt: 3 }}>
          <ProjectUpdates updates={projectView.updates} />
        </Box>
      ) : null}
      {activeTab === "requests" ? (
        <Box sx={{ pt: 3 }}>
          <ServiceRequestList requests={requests} projectId={project.id} />
        </Box>
      ) : null}
      {activeTab === "files" ? (
        <Box sx={{ pt: 3 }}>
          <ProjectFiles files={projectView.attachments} />
        </Box>
      ) : null}
    </Container>
  );
}
