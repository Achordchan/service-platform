import { Box, Container } from "@mui/material";
import { ProjectDeliveryActions } from "@/components/staff/project-delivery-actions";
import { ProjectDetailWorkspace } from "@/components/staff/project-detail-workspace";
import { StaffPageHeading } from "@/components/staff/staff-page-heading";
import { StaffStatus } from "@/components/staff/staff-status";
import type {
  ProjectDetail,
  RequestListItem,
} from "@/components/staff/staff-types";
import { requireUserWithAccess } from "@/lib/session";
import { getProject } from "@/modules/projects/project-service";
import { listProjectRequests } from "@/modules/requests/request-service";
import { listUsers } from "@/modules/users/user-service";

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
  const staffCandidates = actor.isPlatformAdmin
    ? (
        await Promise.all([
          listUsers(actor, { role: "PLATFORM_ADMIN", limit: 200 }),
          listUsers(actor, { role: "PROJECT_MANAGER", limit: 200 }),
          listUsers(actor, { role: "TECHNICIAN", limit: 200 }),
        ])
      )
        .flat()
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
    currentStage: project.currentStage,
    showMilestones: project.showMilestones,
    showProgress: project.showProgress,
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
    })),
    updates: project.updates.map((update) => ({
      id: update.id,
      title: update.title,
      body: update.body,
      visibility: update.visibility,
      authorName: update.author.name,
      createdAt: update.createdAt.toISOString(),
      comments: update.comments.map((comment) => ({
        id: comment.id,
        body: comment.body,
        visibility: comment.visibility,
        authorName: comment.author.name,
        createdAt: comment.createdAt.toISOString(),
      })),
    })),
    attachments: project.attachments.map((attachment) => ({
      id: attachment.id,
      originalName: attachment.originalName,
      mimeType: attachment.mimeType,
      size: attachment.size,
      visibility: attachment.visibility,
      createdAt: attachment.createdAt.toISOString(),
    })),
  };
  const requestRows: RequestListItem[] = requests.map((request) => ({
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

  const canManage =
    actor.isPlatformAdmin || currentAssignment?.role === "PROJECT_MANAGER";
  const canEditProject = actor.isPlatformAdmin;

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
      <StaffPageHeading
        backHref="/staff/projects"
        backLabel="项目"
        title={project.title}
        description={`${project.customerSpace.name} · ${project.serviceType.name}`}
        status={<StaffStatus value={project.status} />}
        action={
          <ProjectDeliveryActions
            project={projectView}
            canManage={canManage}
            canEditProject={canEditProject}
          />
        }
      />
      <Box sx={{ mt: 3, width: "100%" }}>
        <ProjectDetailWorkspace
          project={projectView}
          requests={requestRows}
          canManage={canManage}
          canEditProject={canEditProject}
          staffCandidates={staffCandidates}
        />
      </Box>
    </Container>
  );
}
