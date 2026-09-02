import { Box } from "@mui/material";
import { PageContainer } from "@/components/shared/page-container";
import { hasRolePermission } from "@/modules/authorization/role-permission-policy";
import { ProjectDeliveryActions } from "@/components/staff/project-delivery-actions";
import { ProjectDetailWorkspace } from "@/components/staff/project-detail-workspace";
import { RealtimeRouteRefresh } from "@/components/shared/realtime-route-refresh";
import { StaffPageHeading } from "@/components/staff/staff-page-heading";
import { StaffStatus } from "@/components/staff/staff-status";
import type {
  ProjectDetail,
  RequestListItem,
} from "@/components/staff/staff-types";
import { requireUserWithAccess } from "@/lib/session";
import { getProject } from "@/modules/projects/project-service";
import { listProjectRequests } from "@/modules/requests/request-service";
import { listAssignableProjectStaff } from "@/modules/users/user-service";
import { getRegisteredPlugin } from "@/modules/plugins/plugin-registry";

export default async function StaffProjectDetailPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { actor } = await requireUserWithAccess();
  const { projectId } = await params;
  const [project, requests] = await Promise.all([
    getProject(actor, projectId),
    listProjectRequests(actor, projectId),
  ]);
  const currentAssignment = project.staff.find(
    (member) => member.user.id === actor.id,
  );
  const externalConnectorKey = project.pluginBindings[0]?.pluginKey ?? null;
  const externalConnectorLabel = externalConnectorKey
    ? getRegisteredPlugin(externalConnectorKey).manifest.name
    : null;
  const canManageStaff =
    actor.isPlatformAdmin ||
    (currentAssignment?.role === "PROJECT_MANAGER" &&
      hasRolePermission(actor, "project.manage_staff"));
  const staffCandidates = canManageStaff
    ? (await listAssignableProjectStaff(actor, projectId))
        .map((user) => ({
          id: user.id,
          name: user.name,
          email: user.email,
          platformRole: user.platformRole as
            | "PLATFORM_ADMIN"
            | "PROJECT_MANAGER"
            | "TECHNICIAN",
        }))
    : [];

  const projectView: ProjectDetail = {
    id: project.id,
    title: project.title,
    description: project.description,
    status: project.status,
    kind: project.kind,
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
    customerSpace: project.customerSpace,
    serviceType: {
      id: project.serviceType.id,
      name: project.serviceType.name,
    },
    managerNames: project.staff
      .filter((member) => member.role === "PROJECT_MANAGER")
      .map((member) => member.user.name),
    requestCount: requests.length,
    contentRiskUiEnabled: project.contentRiskUiEnabled,
    externalConnectorKey,
    externalConnectorLabel,
    staff: project.staff.map((member) => ({
      id: member.id,
      userId: member.user.id,
      name: member.user.name,
      email:
        "email" in member.user && typeof member.user.email === "string"
          ? member.user.email
          : "",
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
      comments: milestone.comments.map((comment) => ({
        id: comment.id,
        body: comment.body,
        authorId: comment.author.id,
        authorName: comment.author.name,
        authorImage: comment.author.image,
        createdAt: comment.createdAt.toISOString(),
        contentRiskStatus: comment.contentRiskStatus,
      })),
    })),
    updates: project.updates.map((update) => ({
      id: update.id,
      title: update.title,
      body: update.body,
      visibility: update.visibility,
      authorName: update.author.name,
      createdAt: update.createdAt.toISOString(),
      updatedAt: update.updatedAt.toISOString(),
      hasEditHistory: update.hasEditHistory,
      contentRiskStatus: update.contentRiskStatus,
      comments: update.comments.map((comment) => ({
        id: comment.id,
        body: comment.body,
        visibility: comment.visibility,
        authorId: comment.authorId,
        authorName: comment.author.name,
        authorImage: comment.author.image,
        createdAt: comment.createdAt.toISOString(),
        updatedAt: comment.updatedAt.toISOString(),
        hasEditHistory: comment.hasEditHistory,
        contentRiskStatus: comment.contentRiskStatus,
      })),
    })),
    attachments: project.attachments.map((attachment) => ({
      id: attachment.id,
      originalName: attachment.originalName,
      title: attachment.title,
      note: attachment.note,
      previewStatus: attachment.previewStatus,
      mimeType: attachment.mimeType,
      size: attachment.size,
      visibility: attachment.visibility,
      createdAt: attachment.createdAt.toISOString(),
      contentRiskStatus: attachment.contentRiskStatus,
      // 来源与收录标记：文件列表靠它们分流「项目文件 / 来自沟通」，
      // 并决定这行给的是「移出项目文件」还是「删除」
      source: attachment.source,
      pinned: attachment.pinned,
    })),
  };
  const requestRows: RequestListItem[] = requests.map((request) => {
    const assignedStaff = request.assignees.length
      ? request.assignees.map((item) => ({
          id: item.user.id,
          name: item.user.name,
        }))
      : request.assignee
        ? [{ id: request.assignee.id, name: request.assignee.name }]
        : [];
    const externalProject = project.kind === "EXTERNAL_INTEGRATION";
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
      customerFilterKey: externalProject
        ? `${externalConnectorKey ?? "EXTERNAL"}_EXTERNAL`
        : project.customerSpace.id,
      customerName: externalProject
        ? `${externalConnectorLabel ?? "外部接入"} 用户`
        : project.customerSpace.name,
      serviceTypeName: project.serviceType.name,
      categoryName: request.category.name,
      assigneeId: request.assigneeId,
      assigneeName:
        assignedStaff.map((member) => member.name).join("、") || null,
      assignedStaff,
      createdByName:
        request.createdBy?.name ??
        request.createdByExternalContact?.displayName ??
        "原提交人已不可用",
      source: request.createdByExternalContact
        ? externalConnectorKey === "universal-embed-connector"
          ? ("UNIVERSAL" as const)
          : ("SUB2API" as const)
        : ("ACHORD" as const),
    };
  });

  const isProjectManager = currentAssignment?.role === "PROJECT_MANAGER";
  const canManageDelivery =
    actor.isPlatformAdmin ||
    (isProjectManager &&
      hasRolePermission(actor, "project.manage_delivery"));
  const canPublishUpdate =
    actor.isPlatformAdmin ||
    (isProjectManager && hasRolePermission(actor, "update.publish"));
  const canUploadFiles =
    actor.isPlatformAdmin ||
    (isProjectManager && hasRolePermission(actor, "file.upload"));
  const canComment =
    actor.isPlatformAdmin ||
    (currentAssignment != null &&
      hasRolePermission(actor, "update.comment"));
  const canEditProject = actor.isPlatformAdmin;

  return (
    <PageContainer sx={{ width: "100%", maxWidth: "100%" }}>
      <RealtimeRouteRefresh
        mode="project-detail"
        projectId={project.id}
        projectDeletedRedirect="/staff/projects"
      />
      <StaffPageHeading
        backHref="/staff/projects"
        backLabel="项目"
        title={project.title}
        description={`${project.customerSpace.name} · ${project.serviceType.name}`}
        status={<StaffStatus value={project.status} />}
        action={
          <ProjectDeliveryActions
            project={projectView}
            canManageDelivery={canManageDelivery}
            canPublishUpdate={canPublishUpdate}
            canEditProject={canEditProject}
            contentRiskNoticeEnabled={
              project.contentRiskUiEnabled && !actor.isPlatformAdmin
            }
          />
        }
      />
      <Box sx={{ mt: 3, width: "100%" }}>
        <ProjectDetailWorkspace
          project={projectView}
          requests={requestRows}
          currentUserId={actor.id}
          canManageDelivery={canManageDelivery}
          canPublishUpdate={canPublishUpdate}
          canManageStaff={canManageStaff}
          canUploadFiles={canUploadFiles}
          canComment={canComment}
          canEditProject={canEditProject}
          staffCandidates={staffCandidates}
          contentRiskNoticeEnabled={
            project.contentRiskUiEnabled && !actor.isPlatformAdmin
          }
        />
      </Box>
    </PageContainer>
  );
}
