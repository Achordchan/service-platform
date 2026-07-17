import { Box, Container } from "@mui/material";
import { RequestDetailWorkspace } from "@/components/staff/request-detail-workspace";
import { StaffPageHeading } from "@/components/staff/staff-page-heading";
import { StaffStatus } from "@/components/staff/staff-status";
import type { RequestDetail } from "@/components/staff/staff-types";
import { requireUserWithAccess } from "@/lib/session";
import { getProject } from "@/modules/projects/project-service";
import { getRequest } from "@/modules/requests/request-service";

export default async function StaffRequestDetailPage({
  params,
}: {
  params: Promise<{ requestId: string }>;
}) {
  const { actor } = await requireUserWithAccess();
  const { requestId } = await params;
  const request = await getRequest(actor, requestId);
  const project = await getProject(actor, request.projectId);
  const currentAssignment = project.staff.find(
    (member) => member.user.id === actor.id,
  );
  const canAssign =
    actor.isPlatformAdmin || currentAssignment?.role === "PROJECT_MANAGER";
  const assigneeIds = [
    ...(request.assigneeId ? [request.assigneeId] : []),
    ...request.assignees.map((item) => item.userId),
  ];
  const requestUnassigned = assigneeIds.length === 0;
  const claimRequired = Boolean(
    !actor.isPlatformAdmin && currentAssignment && requestUnassigned,
  );
  const canManage =
    canAssign ||
    (actor.platformRole === "TECHNICIAN" && assigneeIds.includes(actor.id)) ||
    claimRequired;

  const requestView: RequestDetail = {
    id: request.id,
    number: request.number,
    title: request.title,
    description: request.description,
    priority: request.priority,
    status: request.status,
    createdAt: request.createdAt.toISOString(),
    updatedAt: request.updatedAt.toISOString(),
    projectId: request.projectId,
    projectTitle: request.project.title,
    customerName: project.customerSpace.name,
    serviceTypeName: project.serviceType.name,
    categoryName: request.category.name,
    assigneeId: request.assigneeId,
    assigneeName: request.assignee?.name ?? null,
    assignees: request.assignees.map((item) => ({
      id: item.user.id,
      name: item.user.name,
      email: item.user.email,
      image: item.user.image,
      platformRole: item.user.platformRole,
    })),
    createdByName:
      request.createdBy?.name ??
      request.createdByExternalContact?.displayName ??
      "原提交人已不可用",
    source: request.createdByExternalContact
      ? ("SUB2API" as const)
      : ("ACHORD" as const),
    externalContact: request.createdByExternalContact
      ? {
          externalUserId: request.createdByExternalContact.externalUserId,
          email: request.createdByExternalContact.email,
          username: request.createdByExternalContact.username,
          status: request.createdByExternalContact.status,
        }
      : null,
    attachments: request.attachments.map((attachment) => ({
      id: attachment.id,
      originalName: attachment.originalName,
      mimeType: attachment.mimeType,
      size: attachment.size,
      visibility: attachment.visibility,
      createdAt: attachment.createdAt.toISOString(),
    })),
    messages: request.messages.map((message) => ({
      id: message.id,
      body: message.body,
      isSystem: message.isSystem,
      isInitial: message.isInitial,
      visibility: message.visibility,
      authorId: message.authorId ?? message.externalAuthorId ?? "unavailable",
      authorName:
        message.author?.name ??
        message.externalAuthor?.displayName ??
        "原作者已不可用",
      authorImage: message.author?.image ?? null,
      authorPlatformRole: message.author?.platformRole ?? null,
      authorSource: message.externalAuthor ? "SUB2API" : message.author ? "ACHORD" : "SYSTEM",
      createdAt: message.createdAt.toISOString(),
      replyToMessageId: message.replyToMessageId,
      replyTo: message.replyTo
        ? {
            id: message.replyTo.id,
            body: message.replyTo.body,
            visibility: message.replyTo.visibility,
            authorId:
              message.replyTo.authorId ??
              message.replyTo.externalAuthorId ??
              "unavailable",
            authorName:
              message.replyTo.author?.name ??
              message.replyTo.externalAuthor?.displayName ??
              "原作者已不可用",
            authorSource: message.replyTo.externalAuthor
              ? "SUB2API"
              : message.replyTo.author
                ? "ACHORD"
                : "SYSTEM",
            attachments: message.replyTo.attachments,
          }
        : null,
      attachments: message.attachments.map((attachment) => ({
        id: attachment.id,
        originalName: attachment.originalName,
        mimeType: attachment.mimeType,
        size: attachment.size,
        visibility: attachment.visibility,
        createdAt: attachment.createdAt.toISOString(),
      })),
    })),
  };

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
        backHref="/staff/requests"
        backLabel="服务请求"
        title={request.title}
        description={`${request.number} · ${project.customerSpace.name} · ${project.title}`}
        status={<StaffStatus value={request.status} />}
      />
      <Box sx={{ mt: 3 }}>
        <RequestDetailWorkspace
          request={requestView}
          currentUserId={actor.id}
          projectStaff={(() => {
            const members = project.staff.map((member) => ({
              id: member.id,
              userId: member.user.id,
              name: member.user.name,
              email:
                "email" in member.user && typeof member.user.email === "string"
                  ? member.user.email
                  : "",
              role: member.role,
            }));
            if (
              actor.isPlatformAdmin &&
              !members.some((member) => member.userId === actor.id)
            ) {
              members.unshift({
                id: `admin-${actor.id}`,
                userId: actor.id,
                name: actor.name,
                email: actor.email,
                role: "PROJECT_MANAGER",
              });
            }
            return members;
          })()}
          canManage={canManage}
          canAssign={canAssign}
          claimRequired={claimRequired}
        />
      </Box>
    </Container>
  );
}
