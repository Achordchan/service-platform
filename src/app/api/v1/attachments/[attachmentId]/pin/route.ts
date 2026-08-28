import { NextResponse } from "next/server";
import { z } from "zod";
import { setAttachmentProjectPin } from "@/modules/attachments/attachment-service";
import {
  readJson,
  requireApiActor,
  routeError,
} from "@/modules/projects/api-utils";

const pinSchema = z.object({ pinned: z.boolean() });

type RouteContext = {
  params: Promise<{ attachmentId: string }>;
};

// 「添加到项目文件」/「移出」。权限由 RLS 兜底：看不到这个附件的人改不了它，
// 而收录只翻一个标记、不改归属，因此不会让任何人看到原本看不到的文件。
export async function POST(request: Request, context: RouteContext) {
  const auth = await requireApiActor();
  if (auth.response) return auth.response;

  try {
    const { attachmentId } = await context.params;
    const input = pinSchema.parse(await readJson(request));
    const result = await setAttachmentProjectPin(
      auth.actor,
      attachmentId,
      input.pinned,
    );
    return NextResponse.json({ data: result });
  } catch (error) {
    return routeError(error);
  }
}
