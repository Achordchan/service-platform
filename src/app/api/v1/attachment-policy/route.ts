import { NextResponse } from "next/server";
import { getRuntimeAttachmentPolicy } from "@/modules/platform-settings/platform-setting-service";
import {
  apiErrorResponse,
  requireApiActor,
} from "@/modules/requests/api";

export async function GET(request: Request) {
  try {
    await requireApiActor();
    const policy = await getRuntimeAttachmentPolicy();
    return NextResponse.json({
      data: {
        maxSizeMb: policy.maxSizeMb,
        allowedExtensions: policy.allowedExtensions,
        customerReplyAttachmentsEnabled: policy.customerReplyAttachmentsEnabled,
        accept: policy.allowedExtensions
          .map((item) => (item.startsWith(".") ? item : `.${item}`))
          .join(","),
      },
    });
  } catch (error) {
    return apiErrorResponse(error, {
      request,
      operation: "attachment_policy.get",
    });
  }
}
