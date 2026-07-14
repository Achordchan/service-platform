import {
  getAttachmentPolicy,
} from "@/modules/attachments/attachment-validation";
import {
  uploadProjectAttachment,
  uploadRequestAttachment,
} from "@/modules/attachments/attachment-service";
import {
  apiErrorResponse,
  requireApiActor,
} from "@/modules/requests/api";
import { badRequest } from "@/modules/requests/errors";

export async function POST(request: Request) {
  try {
    const actor = await requireApiActor();
    const policy = await getAttachmentPolicy();
    const maxBytes = Math.max(1, policy.maxSizeMb) * 1024 * 1024;
    const declaredLength = Number(request.headers.get("content-length") ?? 0);
    if (declaredLength > maxBytes + 1024 * 1024) {
      throw badRequest(
        "ATTACHMENT_TOO_LARGE",
        `附件大小不能超过 ${policy.maxSizeMb}MB`,
      );
    }

    const formData = await request.formData();
    const file = formData.get("file");
    const serviceRequestId = formData.get("serviceRequestId");
    const projectId = formData.get("projectId");
    const requestMessageId = formData.get("requestMessageId");
    const visibility = formData.get("visibility");

    if (!(file instanceof File)) {
      throw badRequest("ATTACHMENT_REQUIRED", "请选择附件");
    }
    if (file.size > maxBytes) {
      throw badRequest(
        "ATTACHMENT_TOO_LARGE",
        `附件大小不能超过 ${policy.maxSizeMb}MB`,
      );
    }
    const normalizedRequestId =
      typeof serviceRequestId === "string" ? serviceRequestId.trim() : "";
    const normalizedProjectId =
      typeof projectId === "string" ? projectId.trim() : "";
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
        })
      : await uploadProjectAttachment(actor, {
          fileName: file.name,
          claimedMimeType: file.type,
          buffer,
          projectId: normalizedProjectId,
          visibility: visibility ?? undefined,
        });

    return Response.json({ data: attachment }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
