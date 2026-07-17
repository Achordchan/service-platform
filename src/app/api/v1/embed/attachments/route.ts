import { getAttachmentPolicy } from "@/modules/attachments/attachment-validation";
import { uploadExternalAttachment } from "@/modules/integrations/sub2api/external-attachment-service";
import { requireExternalSession } from "@/modules/integrations/sub2api/session-service";
import { DomainError } from "@/modules/projects/errors";
import { routeError } from "@/modules/projects/api-utils";

export async function POST(request: Request) {
  try {
    const session = await requireExternalSession(request);
    const policy = await getAttachmentPolicy();
    const maxBytes = Math.max(1, policy.maxSizeMb) * 1024 * 1024;
    const declaredLength = Number(request.headers.get("content-length") ?? 0);
    if (declaredLength > maxBytes + 1024 * 1024) {
      throw new DomainError(
        "ATTACHMENT_TOO_LARGE",
        `附件大小不能超过 ${policy.maxSizeMb}MB`,
        413,
      );
    }
    const formData = await request.formData();
    const file = formData.get("file");
    const serviceRequestId = String(formData.get("serviceRequestId") ?? "").trim();
    const requestMessageId = String(formData.get("requestMessageId") ?? "").trim();
    if (!(file instanceof File) || !serviceRequestId) {
      throw new DomainError(
        "ATTACHMENT_INPUT_INVALID",
        "请选择附件并指定工单",
        422,
      );
    }
    if (file.size > maxBytes) {
      throw new DomainError(
        "ATTACHMENT_TOO_LARGE",
        `附件大小不能超过 ${policy.maxSizeMb}MB`,
        413,
      );
    }
    const data = await uploadExternalAttachment(session.actor, {
      fileName: file.name,
      claimedMimeType: file.type,
      buffer: new Uint8Array(await file.arrayBuffer()),
      serviceRequestId,
      requestMessageId: requestMessageId || undefined,
    });
    return Response.json({ data }, { status: 201 });
  } catch (error) {
    return routeError(error);
  }
}
