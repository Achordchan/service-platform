import { checkRateLimit } from "@/lib/rate-limit";
import { readJson } from "@/modules/projects/api-utils";
import { DomainError } from "@/modules/projects/errors";
import {
  apiErrorResponse,
  requireApiActor,
} from "@/modules/requests/api";
import { submitFeedback } from "@/modules/feedback/feedback-service";
import { submitFeedbackSchema } from "@/modules/feedback/schemas";

export const dynamic = "force-dynamic";

// 提交用户反馈：任何已登录用户（客户/员工，Web cookie 会话或小程序
// Bearer 会话）都可提交。落库是事实源；GitHub issue 为附带同步通道。
export async function POST(request: Request) {
  try {
    const actor = await requireApiActor();

    // 按用户限流防刷：写库 + 建 issue 都是真实副作用。
    if (!checkRateLimit(`feedback:submit:${actor.id}`, 5, 3_600_000)) {
      throw new DomainError(
        "RATE_LIMITED",
        "反馈提交过于频繁，请稍后再试",
        429,
      );
    }

    const input = submitFeedbackSchema.parse(
      await readJson(request, { maxBytes: 64 * 1024 }),
    );

    // 来源由服务端判定，不信任客户端自报：resolveApiActor 的规则是
    // 带 Authorization 头的一律是小程序 Bearer 会话，否则是 Web cookie 会话。
    const source = request.headers.has("authorization")
      ? ("MINIAPP" as const)
      : ("WEB" as const);

    const result = await submitFeedback(actor, input, source);
    return Response.json({ data: result });
  } catch (error) {
    return apiErrorResponse(error, {
      request,
      operation: "feedback.submit",
    });
  }
}
