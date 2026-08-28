import "server-only";

/** 反向代理后的客户端来源 IP。
 * 取 x-forwarded-for **最右段**：部署在单层 nginx（append 模式）之后，最右段由我们
 * 自己的代理追加、不可被请求方伪造；最左段可由认证客户端直接注入伪造 XFF 首段。
 * 信任模型与 rate-limit.ts 的 clientIpFromRequest 一致。XFF 缺失时退回 nginx 覆写的
 * x-real-ip，再无则 null（审计如实记「未知」而非假地址）。 */
export function clientIpFromHeaders(source: Headers): string | null {
  const forwardedFor = source.get("x-forwarded-for");
  const rightmost = forwardedFor?.split(",").pop()?.trim();
  if (rightmost) return rightmost;
  const realIp = source.get("x-real-ip")?.trim();
  return realIp || null;
}
