import "server-only";

import { headers } from "next/headers";

export type RequestNetwork = {
  ipAddress: string | null;
  userAgent: string | null;
};

/** 从代理头解析客户端来源 IP（取 x-forwarded-for 第一跳），退回 x-real-ip。 */
export function clientIpFromHeaders(source: Headers): string | null {
  const forwardedFor = source.get("x-forwarded-for");
  const firstHop = forwardedFor?.split(",")[0]?.trim();
  if (firstHop) return firstHop;
  const realIp = source.get("x-real-ip")?.trim();
  return realIp || null;
}

/** 读取当前请求的来源 IP / User-Agent，供审计写入携带。无请求上下文时返回 null。 */
export async function readRequestNetwork(): Promise<RequestNetwork> {
  const source = await headers();
  return {
    ipAddress: clientIpFromHeaders(source),
    userAgent: source.get("user-agent"),
  };
}
