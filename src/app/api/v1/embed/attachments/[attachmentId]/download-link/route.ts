import { NextResponse } from "next/server";
import { createEmbedAttachmentDownloadToken } from "@/modules/integrations/external/attachment-download-link";
import { requireExternalSession } from "@/modules/integrations/external/session-service";
import { routeError } from "@/modules/projects/api-utils";
import { DomainError } from "@/modules/projects/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ attachmentId: string }> };

// 只签给 native 会话：iframe 门户继续用带 Authorization 头的 blob 下载。
// 附件访问权在兑现链接时按会话现状重新校验，这里不预读附件。
export async function POST(request: Request, context: RouteContext) {
  try {
    const session = await requireExternalSession(request);
    if (session.launchMode !== "native") {
      throw new DomainError(
        "EMBED_DOWNLOAD_LINK_NATIVE_ONLY",
        "仅原生应用启动的会话可以获取附件下载链接",
        403,
      );
    }
    const { attachmentId } = await context.params;
    const { token, expiresAt } = createEmbedAttachmentDownloadToken(
      session.sessionId,
      attachmentId,
    );
    return NextResponse.json(
      {
        data: {
          url: `/api/v1/embed/attachments/${encodeURIComponent(attachmentId)}?download=${encodeURIComponent(token)}`,
          expiresAt: expiresAt.toISOString(),
        },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return routeError(error);
  }
}
