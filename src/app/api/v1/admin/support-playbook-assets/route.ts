import { getAttachmentPolicy } from "@/modules/attachments/attachment-validation";
import {
  readBoundedFormData,
  RequestBodyTooLargeError,
} from "@/modules/attachments/bounded-form-data";
import { uploadSupportPlaybookImage } from "@/modules/attachments/attachment-service";
import { apiErrorResponse, requireApiActor } from "@/modules/requests/api";
import { badRequest, payloadTooLarge } from "@/modules/requests/errors";

export async function POST(request: Request) {
  try {
    const actor = await requireApiActor();
    const policy = await getAttachmentPolicy();
    const maxBytes = Math.max(1, policy.maxSizeMb) * 1024 * 1024;
    let formData: FormData;
    try {
      formData = await readBoundedFormData(request, maxBytes + 1024 * 1024);
    } catch (error) {
      if (!(error instanceof RequestBodyTooLargeError)) throw error;
      throw payloadTooLarge(
        "ATTACHMENT_TOO_LARGE",
        `图片大小不能超过 ${policy.maxSizeMb}MB`,
      );
    }
    const file = formData.get("file");
    if (!(file instanceof File)) {
      throw badRequest("ATTACHMENT_REQUIRED", "请选择图片");
    }
    if (file.size > maxBytes) {
      throw payloadTooLarge(
        "ATTACHMENT_TOO_LARGE",
        `图片大小不能超过 ${policy.maxSizeMb}MB`,
      );
    }
    const attachment = await uploadSupportPlaybookImage(actor, {
      fileName: file.name,
      claimedMimeType: file.type,
      buffer: new Uint8Array(await file.arrayBuffer()),
    });
    return Response.json({ data: attachment }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error, {
      request,
      operation: "support_playbook_asset.upload",
    });
  }
}
