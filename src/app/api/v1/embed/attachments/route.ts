import { getAttachmentPolicy } from "@/modules/attachments/attachment-validation";
import {
  readBoundedFormData,
  RequestBodyTooLargeError,
} from "@/modules/attachments/bounded-form-data";
import { uploadExternalAttachment } from "@/modules/integrations/external/attachment-service";
import { requireExternalSession } from "@/modules/integrations/external/session-service";
import { DomainError } from "@/modules/projects/errors";
import { routeError } from "@/modules/projects/api-utils";

export async function POST(request: Request) {
  try {
    const session = await requireExternalSession(request);
    const policy = await getAttachmentPolicy();
    const maxBytes = Math.max(1, policy.maxSizeMb) * 1024 * 1024;
    let formData: FormData;
    try {
      formData = await readBoundedFormData(request, maxBytes + 1024 * 1024);
    } catch (error) {
      if (!(error instanceof RequestBodyTooLargeError)) throw error;
      throw new DomainError(
        "ATTACHMENT_TOO_LARGE",
        `附件大小不能超过 ${policy.maxSizeMb}MB`,
        413,
      );
    }
    const file = formData.get("file");
    const serviceRequestId = String(formData.get("serviceRequestId") ?? "").trim();
    const requestMessageId = String(formData.get("requestMessageId") ?? "").trim();
    const inline = formData.get("inline") === "true";
    if (!(file instanceof File) || !serviceRequestId) {
      throw new DomainError(
        "ATTACHMENT_INPUT_INVALID",
        "请选择附件并指定服务请求",
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
    const title = formData.get("title");
    const note = formData.get("note");
    const data = await uploadExternalAttachment(session.actor, {
      fileName: file.name,
      claimedMimeType: file.type,
      buffer: new Uint8Array(await file.arrayBuffer()),
      serviceRequestId,
      requestMessageId: requestMessageId || undefined,
      inline,
      title: typeof title === "string" ? title : undefined,
      note: typeof note === "string" ? note : undefined,
    }, {
      customerMemberNotificationsEnabled:
        session.connection.customerMemberNotificationsEnabled,
    });
    return Response.json({ data }, { status: 201 });
  } catch (error) {
    return routeError(error);
  }
}
