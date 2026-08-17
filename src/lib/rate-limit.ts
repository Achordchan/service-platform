import "server-only";

// 进程内滑动窗口限流：适用于公开端点的滥用防护（票据创建 / 小程序码生成等）。
// 仅覆盖单实例部署；多实例时需换共享存储（Redis）。

type Window = { hits: number[] };

const windows = new Map<string, Window>();

function evictExpired(window: Window, windowMs: number, now: number) {
  window.hits = window.hits.filter((t) => now - t < windowMs);
}

function sweepIfDue(windowMs: number, now: number) {
  if (windows.size < 10_000) return;
  for (const [key, window] of windows) {
    evictExpired(window, windowMs, now);
    if (window.hits.length === 0) windows.delete(key);
  }
}

/** 命中返回 true 并记账；超限返回 false */
export function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number,
): boolean {
  const now = Date.now();
  sweepIfDue(windowMs, now);
  const window = windows.get(key) ?? { hits: [] };
  evictExpired(window, windowMs, now);
  if (window.hits.length >= limit) {
    windows.set(key, window);
    return false;
  }
  window.hits.push(now);
  windows.set(key, window);
  return true;
}

/** 反向代理后的客户端 IP。
 * 取 XFF 最右段：部署在单层 nginx（append 模式）之后，最右段由我们自己的
 * 代理追加、不可被请求方伪造；最左段可由客户端直接注入假 XFF 首段绕过限流。 */
export function clientIpFromRequest(request: Request): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  const last = forwardedFor?.split(",").pop()?.trim();
  return last || "unknown";
}
