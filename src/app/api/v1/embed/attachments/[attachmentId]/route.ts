import { readExternalAttachment } from "@/modules/integrations/sub2api/external-attachment-service";
import { requireExternalSession } from "@/modules/integrations/sub2api/session-service";
import { routeError } from "@/modules/projects/api-utils";

type RouteContext = { params: Promise<{ attachmentId: string }> };

export async function GET(request: Request, context: RouteContext) {
  try {
    const session = await requireExternalSession(request);
    const { attachmentId } = await context.params;
    const inlineRequested =
      new URL(request.url).searchParams.get("disposition") === "inline";
    const { attachment, buffer } = await readExternalAttachment(
      session.actor,
      attachmentId,
      { inlinePreview: inlineRequested },
    );
    const inline = inlineRequested && attachment.mimeType.startsWith("image/");
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
