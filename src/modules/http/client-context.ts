import "server-only";

import { UAParser } from "ua-parser-js";

/**
 * 归属地查询：ip2region 是纯本地 xdb（11MB，随包安装），不发外部请求，
 * 因此不会把客户 IP 泄露给第三方；中国大陆到省市级、海外到国家级。
 * 首次调用时惰性加载，失败则整体降级为「未知」而不是抛错 —— 归属地只是
 * 排查用的辅助信息，不该让在线状态或工单详情因此挂掉。
 */
type Ip2RegionResult = {
  country?: string;
  province?: string;
  city?: string;
  isp?: string;
};

let searcher: { search(ip: string): Ip2RegionResult | null } | null = null;
let searcherFailed = false;

function loadSearcher() {
  if (searcher || searcherFailed) return searcher;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("ip2region") as {
      default: new () => { search(ip: string): Ip2RegionResult | null };
    };
    searcher = new mod.default();
  } catch {
    searcherFailed = true;
  }
  return searcher;
}

const PRIVATE_V4 =
  /^(10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/;

export function isPrivateAddress(ip: string) {
  if (!ip) return false;
  if (ip === "::1" || ip.startsWith("fc") || ip.startsWith("fd")) return true;
  return PRIVATE_V4.test(ip);
}

/** 把 IP 翻成「中国 江苏省 南京市」这类可读归属地；查不到返回 null */
export function resolveIpLocation(ip: string | null | undefined) {
  const value = ip?.trim();
  if (!value) return null;
  if (isPrivateAddress(value)) return "内网地址";
  // ip2region 的 xdb 只索引 IPv4；IPv6 直接放弃而不是给出错误答案
  if (value.includes(":")) return null;
  const result = loadSearcher()?.search(value) ?? null;
  if (!result) return null;
  const parts = [result.country, result.province, result.city]
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part) && part !== "0");
  const location = [...new Set(parts)].join(" ");
  const isp = result.isp?.trim();
  if (!location) return isp || null;
  return isp ? `${location} · ${isp}` : location;
}

/** User-Agent → 「iPhone · 微信」这类可读设备描述 */
export function describeUserAgent(userAgent: string | null | undefined) {
  const value = userAgent?.trim();
  if (!value) return null;
  const parsed = UAParser(value);
  const device = [parsed.device.vendor, parsed.device.model]
    .filter(Boolean)
    .join(" ");
  const os = [parsed.os.name, parsed.os.version].filter(Boolean).join(" ");
  const browser = [parsed.browser.name, parsed.browser.version?.split(".")[0]]
    .filter(Boolean)
    .join(" ");
  const parts = [device || null, os || null, browser || null].filter(
    (part): part is string => Boolean(part),
  );
  return parts.length > 0 ? parts.join(" · ") : value.slice(0, 80);
}
