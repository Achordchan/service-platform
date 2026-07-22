import { readAttachmentDownload } from "@/modules/attachments/attachment-service";
import {
  apiErrorResponse,
  requireApiActor,
} from "@/modules/requests/api";

type RouteContext = {
  params: Promise<{ attachmentId: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  try {
    const actor = await requireApiActor();
    const { attachmentId } = await context.params;
    const inlineRequested =
      new URL(request.url).searchParams.get("disposition") === "inline";
    const { attachment, buffer } = await readAttachmentDownload(
      actor,
      attachmentId,
      { inlinePreview: inlineRequested },
    );
    const inline =
      inlineRequested && attachment.mimeType.startsWith("image/");

    return new Response(buffer, {
      headers: {
        "Content-Type": attachment.mimeType,
        "Content-Length": String(buffer.byteLength),
        "Content-Disposition": contentDisposition(
          downloadFileName(attachment.originalName, attachment.mimeType),
          inline ? "inline" : "attachment",
        ),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return apiErrorResponse(error, {
      request,
      operation: "attachment.download",
    });
  }
}

function downloadFileName(fileName: string, mimeType: string) {
  if (mimeType !== "image/webp" || /\.webp$/i.test(fileName)) {
    return fileName;
  }
  const base = fileName.replace(/\.[^.]+$/, "") || "image";
  return `${base}.webp`;
}

function contentDisposition(
  fileName: string,
  disposition: "inline" | "attachment",
) {
  const asciiName = fileName
    .replace(/[^\x20-\x7E]/g, "_")
    .replace(/["\\]/g, "_");
  return `${disposition}; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}
