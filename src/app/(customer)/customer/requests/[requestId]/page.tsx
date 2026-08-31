import { PageContainer } from "@/components/shared/page-container";
import { redirect } from "next/navigation";
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
  if (query.created !== undefined) {
    redirect(`/customer/requests/${requestId}`);
  }
  const request = await getRequest(actor, requestId);
  const project = await getProject(actor, request.projectId);

  const requestView: ServiceRequestDetail = {
    id: request.id,
    number: request.number,
    title: request.title,
    description: request.description,
    priority: request.priority,
    status: request.status,
    archivedAt: request.archivedAt?.toISOString() ?? null,
    createdAt: request.createdAt.toISOString(),
    updatedAt: request.updatedAt.toISOString(),
    projectId: request.projectId,
    projectTitle: request.project.title,
    serviceTypeName: project.serviceType.name,
    category: request.category,
    assigneeName: request.assignee?.name ?? null,
    assigneeNames: request.assignees.map((item) => item.user.name),
    createdByName:
      request.createdBy?.name ??
      request.createdByExternalContact?.displayName ??
      "原提交人已不可用",
    contentRiskUiEnabled: request.contentRiskUiEnabled,
    attachments: request.attachments.map((attachment) => ({
      id: attachment.id,
      originalName: attachment.originalName,
      title: attachment.title,
      note: attachment.note,
      previewStatus: attachment.previewStatus,
      mimeType: attachment.mimeType,
      size: attachment.size,
      createdAt: attachment.createdAt.toISOString(),
      contentRiskStatus: attachment.contentRiskStatus,
    })),
    messages: request.messages.map((message) => ({
      id: message.id,
      body: message.body,
      bodyIsAttachmentPlaceholder: message.bodyIsAttachmentPlaceholder,
      isSystem: message.isSystem,
      isInitial: message.isInitial,
      supportPlaybook: message.supportPlaybook,
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
            bodyIsAttachmentPlaceholder:
              message.replyTo.bodyIsAttachmentPlaceholder,
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
        title: attachment.title,
        note: attachment.note,
        previewStatus: attachment.previewStatus,
        mimeType: attachment.mimeType,
        size: attachment.size,
        createdAt: attachment.createdAt.toISOString(),
        contentRiskStatus: attachment.contentRiskStatus,
      })),
      contentRiskStatus: message.contentRiskStatus,
      contentRiskReason: message.contentRiskReason,
      reeditBody: message.reeditBody,
      reeditAttachmentCount: message.reeditAttachmentCount,
      reeditExpiresAt: message.reeditExpiresAt?.toISOString() ?? null,
    })),
  };

  return (
    <PageContainer>
      <RequestDetail request={requestView} currentUserId={actor.id} />
    </PageContainer>
  );
}
