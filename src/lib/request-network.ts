import "server-only";

/** 从代理头解析客户端来源 IP（取 x-forwarded-for 第一跳），退回 x-real-ip。 */
export function clientIpFromHeaders(source: Headers): string | null {
  const forwardedFor = source.get("x-forwarded-for");
  const firstHop = forwardedFor?.split(",")[0]?.trim();
  if (firstHop) return firstHop;
  const realIp = source.get("x-real-ip")?.trim();
  return realIp || null;
}
