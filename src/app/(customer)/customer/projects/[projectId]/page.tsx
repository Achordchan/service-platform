import { Box } from "@mui/material";
import { PageContainer } from "@/components/shared/page-container";
import { notFound } from "next/navigation";
import type {
  ProjectDetail,
  ServiceRequestSummary,
} from "@/components/customer/customer-types";
import { PageHeading } from "@/components/customer/page-heading";
import { MilestoneTimeline } from "@/components/customer/milestone-timeline";
import { ProjectFiles } from "@/components/customer/project-files";
import { ProjectOverview } from "@/components/customer/project-overview";
import {
  ProjectTabs,
  type ProjectTabKey as TabKey,
} from "@/components/customer/project-tabs";
import { ProjectUpdates } from "@/components/customer/project-updates";
import { RealtimeRouteRefresh } from "@/components/shared/realtime-route-refresh";
import { ServiceRequestList } from "@/components/customer/service-request-list";
import { EmptyState } from "@/components/shared/content-state";
import { StatusIndicator } from "@/components/shared/status-indicator";
import { requireUserWithAccess } from "@/lib/session";
import { getProject } from "@/modules/projects/project-service";
import { DomainError } from "@/modules/projects/errors";
import { listProjectRequests } from "@/modules/requests/request-service";

const validTabs = new Set<TabKey>([
  "overview",
  "milestones",
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
  const project = await getProject(actor, projectId).catch((error: unknown) => {
    if (error instanceof DomainError && error.status === 404) {
      notFound();
    }
    throw error;
  });
  const milestonesEnabled = project.showMilestones !== false;
  const updatesEnabled = project.customerUpdatesEnabled !== false;
  const requestsEnabled = project.customerRequestsEnabled !== false;
  const filesEnabled = project.customerFilesEnabled !== false;
  const requestedTabEnabled =
    requestedTab === "milestones"
      ? milestonesEnabled
      : requestedTab === "updates"
        ? updatesEnabled
        : requestedTab === "requests"
          ? requestsEnabled
          : requestedTab === "files"
            ? filesEnabled
            : true;
  const activeTab: TabKey =
    requestedTab &&
    validTabs.has(requestedTab as TabKey) &&
    requestedTabEnabled
      ? (requestedTab as TabKey)
      : "overview";
  const requestResult = requestsEnabled
    ? await listProjectRequests(actor, projectId)
    : [];

  const projectView: ProjectDetail = {
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
    managerNames: project.staff
      .filter((member) => member.role === "PROJECT_MANAGER")
      .map((member) => member.user.name),
    requestCount: requestResult.filter((request) => !request.archivedAt).length,
    updateCount: project.updates.length,
    contentRiskUiEnabled: project.contentRiskUiEnabled,
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
      createdAt: milestone.createdAt.toISOString(),
      contentRiskStatus: milestone.contentRiskStatus,
    })),
    updates: project.updates.map((update) => ({
      id: update.id,
      title: update.title,
      body: update.body,
      authorName: update.author.name,
      createdAt: update.createdAt.toISOString(),
      updatedAt: update.updatedAt.toISOString(),
      contentRiskStatus: update.contentRiskStatus,
      comments: update.comments.map((comment) => ({
        id: comment.id,
        body: comment.body,
        authorName: comment.author.name,
        createdAt: comment.createdAt.toISOString(),
        updatedAt: comment.updatedAt.toISOString(),
        contentRiskStatus: comment.contentRiskStatus,
      })),
    })),
    attachments: project.attachments.map((attachment) => ({
      id: attachment.id,
      originalName: attachment.originalName,
      mimeType: attachment.mimeType,
      size: attachment.size,
      createdAt: attachment.createdAt.toISOString(),
      contentRiskStatus: attachment.contentRiskStatus,
    })),
  };
  const requests = requestResult.map((request) =>
    requestSummary(request, project),
  );

  return (
    <PageContainer sx={{ width: "100%", maxWidth: "100%" }}>
      <RealtimeRouteRefresh
        mode="project-detail"
        projectId={project.id}
        projectDeletedRedirect="/customer/projects"
      />
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
        actionLabel={
          requestsEnabled && activeTab !== "requests"
            ? "提交服务请求"
            : undefined
        }
        actionHref={
          requestsEnabled && activeTab !== "requests"
            ? `/customer/requests/new?projectId=${project.id}`
            : undefined
        }
        status={<StatusIndicator status={project.status} />}
      />
      <ProjectTabs
        projectId={project.id}
        activeTab={activeTab}
        requestIds={requests.map((item) => item.id)}
        milestonesEnabled={milestonesEnabled}
        updatesEnabled={updatesEnabled}
        requestsEnabled={requestsEnabled}
        filesEnabled={filesEnabled}
      />
      {activeTab === "overview" ? (
        <ProjectOverview project={projectView} requests={requests} />
      ) : null}
      {activeTab === "milestones" && milestonesEnabled ? (
        <Box sx={{ pt: 3 }}>
          {projectView.milestones.length > 0 ? (
            <MilestoneTimeline
              milestones={projectView.milestones}
              contentRiskEnabled={projectView.contentRiskUiEnabled}
            />
          ) : (
            <EmptyState
              title="暂无里程碑"
              description="项目计划确认后将在此显示。"
            />
          )}
        </Box>
      ) : null}
      {activeTab === "updates" && updatesEnabled ? (
        <Box sx={{ pt: 3 }}>
          <ProjectUpdates
            updates={projectView.updates}
            contentRiskEnabled={projectView.contentRiskUiEnabled}
          />
        </Box>
      ) : null}
      {activeTab === "requests" && requestsEnabled ? (
        <Box sx={{ pt: 3 }}>
          <ServiceRequestList requests={requests} projectId={project.id} />
        </Box>
      ) : null}
      {activeTab === "files" && filesEnabled ? (
        <Box sx={{ pt: 3 }}>
          <ProjectFiles
            files={projectView.attachments}
            contentRiskEnabled={projectView.contentRiskUiEnabled}
          />
        </Box>
      ) : null}
    </PageContainer>
  );
}
