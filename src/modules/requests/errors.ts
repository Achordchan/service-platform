export class RequestDomainError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "RequestDomainError";
  }
}

export function badRequest(code: string, message: string) {
  return new RequestDomainError(code, message, 400);
}

export function forbidden(message = "无权执行此操作") {
  return new RequestDomainError("FORBIDDEN", message, 403);
}

export function notFound(message = "服务请求不存在") {
  return new RequestDomainError("NOT_FOUND", message, 404);
}

export function conflict(code: string, message: string) {
  return new RequestDomainError(code, message, 409);
}
