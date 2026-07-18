import { isIP } from "node:net";

export type ExternalClientFingerprint = {
  ipAddress: string | null;
  userAgent: string | null;
};

function normalizeForwardedIp(value: string | null) {
  const candidate =
    value?.split(",")[0]?.trim().replace(/^\[|\]$/g, "") ?? "";
  if (isIP(candidate)) return candidate;
  const ipv4WithPort = /^(\d+\.\d+\.\d+\.\d+):\d+$/.exec(candidate);
  return ipv4WithPort && isIP(ipv4WithPort[1]) ? ipv4WithPort[1] : null;
}

export function extractExternalClientFingerprint(headers: Headers) {
  const ipAddress =
    normalizeForwardedIp(headers.get("x-real-ip")) ??
    normalizeForwardedIp(headers.get("cf-connecting-ip")) ??
    normalizeForwardedIp(headers.get("x-forwarded-for"));
  const userAgent =
    headers
      .get("user-agent")
      ?.replace(/[\u0000-\u001F\u007F]/g, " ")
      .trim()
      .slice(0, 500) || null;
  return { ipAddress, userAgent } satisfies ExternalClientFingerprint;
}
