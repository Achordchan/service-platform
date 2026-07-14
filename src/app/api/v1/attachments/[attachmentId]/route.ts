import { readAttachmentDownload } from "@/modules/attachments/attachment-service";
import {
  apiErrorResponse,
  requireApiActor,
} from "@/modules/requests/api";

type RouteContext = {
  params: Promise<{ attachmentId: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  try {
    const actor = await requireApiActor();
    const { attachmentId } = await context.params;
    const { attachment, buffer } = await readAttachmentDownload(
      actor,
      attachmentId,
    );

    return new Response(buffer, {
      headers: {
        "Content-Type": attachment.mimeType,
        "Content-Length": String(buffer.byteLength),
        "Content-Disposition": contentDisposition(attachment.originalName),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

function contentDisposition(fileName: string) {
  const asciiName = fileName
    .replace(/[^\x20-\x7E]/g, "_")
    .replace(/["\\]/g, "_");
  return `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}
