import { Container } from "@mui/material";
import type { ServiceRequestDetail } from "@/components/customer/customer-types";
import { RequestDetail } from "@/components/customer/request-detail";
import { requireUserWithAccess } from "@/lib/session";
import { getProject } from "@/modules/projects/project-service";
import { getRequest } from "@/modules/requests/request-service";

export default async function CustomerRequestDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ requestId: string }>;
  searchParams: Promise<{ created?: string | string[] }>;
}) {
  const { actor } = await requireUserWithAccess();
  const { requestId } = await params;
  const query = await searchParams;
  const request = await getRequest(actor, requestId);
  const project = await getProject(actor, request.projectId);

  const requestView: ServiceRequestDetail = {
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
    serviceTypeName: project.serviceType.name,
    category: request.category,
    assigneeName: request.assignee?.name ?? null,
    assigneeNames: request.assignees.map((item) => item.user.name),
    createdByName: request.createdBy.name,
    attachments: request.attachments.map((attachment) => ({
      id: attachment.id,
      originalName: attachment.originalName,
      mimeType: attachment.mimeType,
      size: attachment.size,
      createdAt: attachment.createdAt.toISOString(),
    })),
    messages: request.messages.map((message) => ({
      id: message.id,
      body: message.body,
      isSystem: message.isSystem,
      authorId: message.authorId,
      authorName: message.author.name,
      authorImage: message.author.image,
      authorPlatformRole: message.author.platformRole,
      createdAt: message.createdAt.toISOString(),
      attachments: message.attachments.map((attachment) => ({
        id: attachment.id,
        originalName: attachment.originalName,
        mimeType: attachment.mimeType,
        size: attachment.size,
        createdAt: attachment.createdAt.toISOString(),
      })),
    })),
  };

  return (
    <Container
      maxWidth={false}
      sx={{ px: { xs: 2, md: 3.5 }, py: { xs: 3, md: 4 } }}
    >
      <RequestDetail
        request={requestView}
        currentUserId={actor.id}
        created={
          (Array.isArray(query.created)
            ? query.created[0]
            : query.created) === "1"
        }
      />
    </Container>
  );
}
