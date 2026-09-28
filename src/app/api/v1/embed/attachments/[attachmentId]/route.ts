import { isInlinePreviewableMimeType } from "@/modules/attachments/attachment-meta";
import { verifyEmbedAttachmentDownloadToken } from "@/modules/integrations/external/attachment-download-link";
import { readExternalAttachment } from "@/modules/integrations/external/attachment-service";
import {
  requireExternalSession,
  requireExternalSessionById,
} from "@/modules/integrations/external/session-service";
import { routeError } from "@/modules/projects/api-utils";
import { DomainError } from "@/modules/projects/errors";

type RouteContext = { params: Promise<{ attachmentId: string }> };

export async function GET(request: Request, context: RouteContext) {
  try {
    const { attachmentId } = await context.params;
    const searchParams = new URL(request.url).searchParams;
    const downloadToken = searchParams.get("download");
    const session = downloadToken
      ? await sessionFromDownloadToken(downloadToken, attachmentId)
      : await requireExternalSession(request);
    const inlineRequested =
      !downloadToken && searchParams.get("disposition") === "inline";
    const { attachment, buffer } = await readExternalAttachment(
      session.actor,
      attachmentId,
      { inlinePreview: inlineRequested },
    );
    const inline =
      inlineRequested && isInlinePreviewableMimeType(attachment.mimeType);
    const fileName =
      attachment.mimeType === "image/webp" &&
      !/\.webp$/i.test(attachment.originalName)
        ? `${attachment.originalName.replace(/\.[^.]+$/, "") || "image"}.webp`
        : attachment.originalName;
    const asciiName = fileName
      .replace(/[^\x20-\x7E]/g, "_")
      .replace(/["\\]/g, "_");
    return new Response(buffer, {
      headers: {
        "Content-Type": attachment.mimeType,
        "Content-Length": String(buffer.byteLength),
        "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return routeError(error);
  }
}

async function sessionFromDownloadToken(token: string, attachmentId: string) {
  const sessionId = verifyEmbedAttachmentDownloadToken(token, attachmentId);
  const session = sessionId ? await requireExternalSessionById(sessionId) : null;
  if (!session || session.launchMode !== "native") {
    throw new DomainError(
      "EMBED_DOWNLOAD_LINK_INVALID",
      "下载链接已失效，请回到应用中重新点击附件",
      401,
    );
  }
  return session;
}
