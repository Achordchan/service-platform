import { NextResponse } from "next/server";
import { redactPath } from "@/lib/error-log";
import {
  newSystemErrorReferenceId,
  reportSystemError,
  type SystemErrorActor,
} from "@/lib/system-error-log";

export type ApiErrorContext = {
  operation?: string;
  request?: Request;
  source: string;
  /** 调用点已经知道身份时直接传，省去报错时再查一次库 */
  actor?: SystemErrorActor;
};

const MAX_PATH_LENGTH = 320;

// 动态引入：error-actor 依赖会话与数据库模块，api-error 被很多路由共用，
// 不能因为引入链而形成循环依赖或拖慢冷启动
function resolveErrorActorLazily() {
  return import("@/lib/error-actor")
    .then(({ resolveErrorActor }) => resolveErrorActor())
    .catch(() => undefined);
}

function requestContext(request?: Request) {
  if (!request) return undefined;
  try {
    const url = new URL(request.url);
    return {
      method: request.method,
      path: redactPath(url.pathname).slice(0, MAX_PATH_LENGTH),
    };
  } catch {
    return { method: request.method };
  }
}

export function unexpectedApiErrorResponse(
  error: unknown,
  context: ApiErrorContext,
) {
  const referenceId = newSystemErrorReferenceId();
  const request = requestContext(context.request);

  // console 同步打印，落库在后台进行：不拖慢 500 响应，库不可用时也不影响响应。
  // 身份解析要读请求头，必须在这里（请求上下文内）同步发起。
  const pendingActor = context.actor ? undefined : resolveErrorActorLazily();
  reportSystemError(
    error,
    {
      referenceId,
      source: context.source,
      operation: context.operation,
      request,
      actor: context.actor,
      logLabel: "ACHORD_API_UNEXPECTED_ERROR",
      event: "api.unexpected_error",
    },
    pendingActor,
  );

  return NextResponse.json(
    {
      error: {
        code: "INTERNAL_ERROR",
        message: `操作暂时失败，请稍后重试。错误编号：${referenceId}`,
        referenceId,
      },
    },
    {
      status: 500,
      headers: {
        "Cache-Control": "no-store",
        "X-Achord-Error-Id": referenceId,
      },
    },
  );
}
