import {
  getAttachmentPolicy,
} from "@/modules/attachments/attachment-validation";
import {
  readBoundedFormData,
  RequestBodyTooLargeError,
} from "@/modules/attachments/bounded-form-data";
import {
  uploadProjectAttachment,
  uploadRequestAttachment,
} from "@/modules/attachments/attachment-service";
import {
  apiErrorResponse,
  requireApiActor,
} from "@/modules/requests/api";
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
        `附件大小不能超过 ${policy.maxSizeMb}MB`,
      );
    }
    const file = formData.get("file");
    const serviceRequestId = formData.get("serviceRequestId");
    const projectId = formData.get("projectId");
    const requestMessageId = formData.get("requestMessageId");
    const visibility = formData.get("visibility");
    const inline = formData.get("inline") === "true";
    const inlineContext = formData.get("inlineContext");

    if (!(file instanceof File)) {
      throw badRequest("ATTACHMENT_REQUIRED", "请选择附件");
    }
    if (file.size > maxBytes) {
      throw payloadTooLarge(
        "ATTACHMENT_TOO_LARGE",
        `附件大小不能超过 ${policy.maxSizeMb}MB`,
      );
    }
    const normalizedRequestId =
      typeof serviceRequestId === "string" ? serviceRequestId.trim() : "";
    const normalizedProjectId =
      typeof projectId === "string" ? projectId.trim() : "";
    if (
      inline &&
      normalizedProjectId &&
      inlineContext !== "REQUEST_DESCRIPTION" &&
      inlineContext !== "PROJECT_UPDATE" &&
      inlineContext !== "MILESTONE"
    ) {
      throw badRequest(
        "INLINE_IMAGE_CONTEXT_REQUIRED",
        "正文图片缺少有效的使用场景",
      );
    }
    if (Boolean(normalizedRequestId) === Boolean(normalizedProjectId)) {
      throw badRequest(
        "ATTACHMENT_TARGET_REQUIRED",
        "必须且只能指定一个项目或服务请求",
      );
    }
    if (
      visibility !== null &&
      visibility !== "CUSTOMER_VISIBLE" &&
      visibility !== "INTERNAL"
    ) {
      throw badRequest("INVALID_VISIBILITY", "附件可见范围不合法");
    }

    const buffer = new Uint8Array(await file.arrayBuffer());
    const attachment = normalizedRequestId
      ? await uploadRequestAttachment(actor, {
          fileName: file.name,
          claimedMimeType: file.type,
          buffer,
          serviceRequestId: normalizedRequestId,
          requestMessageId:
            typeof requestMessageId === "string" && requestMessageId.trim()
              ? requestMessageId.trim()
              : undefined,
          visibility: visibility ?? undefined,
          inline,
        })
      : await uploadProjectAttachment(actor, {
          fileName: file.name,
          claimedMimeType: file.type,
          buffer,
          projectId: normalizedProjectId,
          visibility: visibility ?? undefined,
          inlineContext:
            inline && inlineContext === "REQUEST_DESCRIPTION"
              ? "REQUEST_DESCRIPTION"
              : inline && inlineContext === "PROJECT_UPDATE"
                ? "PROJECT_UPDATE"
                : inline && inlineContext === "MILESTONE"
                  ? "MILESTONE"
                : undefined,
        });

    return Response.json({ data: attachment }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
