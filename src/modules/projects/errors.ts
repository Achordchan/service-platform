export class DomainError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
  ) {
    super(message);
    this.name = "DomainError";
  }
}

export function assertFound<T>(
  value: T | null | undefined,
  message: string,
): asserts value is T {
  if (value == null) {
    throw new DomainError("NOT_FOUND", message, 404);
  }
}

export function assertAllowed(condition: boolean, message = "无权执行此操作") {
  if (!condition) {
    throw new DomainError("FORBIDDEN", message, 403);
  }
}
