import { z } from "zod";

export const CONTENT_CONTACT_RISK_PLUGIN_KEY = "content-contact-risk";

export type ContentContactRiskConfig = {
  baseUrl: string;
  model: string;
  fullAuditEnabled: boolean;
  allowedDomains: string[];
};

export type ContentContactRiskSecrets = {
  apiKey: string;
};

export const CONTENT_CONTACT_RISK_DEFAULT_CONFIG: ContentContactRiskConfig = {
  baseUrl: "",
  model: "",
  fullAuditEnabled: true,
  allowedDomains: [],
};

const configSchema = z
  .object({
    baseUrl: z.string().trim().max(2048).default(""),
    model: z.string().trim().max(255).default(""),
    fullAuditEnabled: z.boolean().default(true),
    allowedDomains: z.array(z.string().trim().min(1).max(253)).max(100).default([]),
  })
  .strict();

const secretSchema = z
  .object({ apiKey: z.string().trim().min(8).max(4096) })
  .strict();

export class ContentContactRiskConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContentContactRiskConfigError";
  }
}

export function parseContentContactRiskConfig(
  value: unknown,
): ContentContactRiskConfig {
  const parsed = configSchema.safeParse(value);
  if (!parsed.success) {
    throw new ContentContactRiskConfigError("联系方式风控插件配置无效");
  }
  const baseUrl = parsed.data.baseUrl
    ? normalizeProviderBaseUrl(parsed.data.baseUrl)
    : "";
  return {
    ...parsed.data,
    baseUrl,
    allowedDomains: [...new Set(parsed.data.allowedDomains.map(normalizeDomain))],
  };
}

export function parseContentContactRiskSecrets(
  value: unknown,
): ContentContactRiskSecrets {
  const parsed = secretSchema.safeParse(value);
  if (!parsed.success) {
    throw new ContentContactRiskConfigError("请填写有效的模型 API Key");
  }
  return parsed.data;
}

export function assertContentContactRiskReady(
  config: ContentContactRiskConfig,
) {
  if (!config.baseUrl) {
    throw new ContentContactRiskConfigError("请填写模型 Base URL");
  }
  if (!config.model) {
    throw new ContentContactRiskConfigError("请先获取并选择模型");
  }
}

function normalizeProviderBaseUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new ContentContactRiskConfigError("模型 Base URL 格式无效");
  }
  const localHttp =
    url.protocol === "http:" &&
    (url.hostname === "127.0.0.1" || url.hostname === "localhost");
  if (url.protocol !== "https:" && !localHttp) {
    throw new ContentContactRiskConfigError("模型 Base URL 必须使用 HTTPS");
  }
  if (url.username || url.password || url.hash || url.search) {
    throw new ContentContactRiskConfigError(
      "模型 Base URL 不能包含账号、密码、查询参数或锚点",
    );
  }
  return url.toString().replace(/\/$/, "");
}

function normalizeDomain(value: string) {
  const domain = value.trim().toLowerCase().replace(/^\.+|\.+$/g, "");
  if (!/^[a-z0-9.-]+$/.test(domain) || !domain.includes(".")) {
    throw new ContentContactRiskConfigError(`允许域名格式无效：${value}`);
  }
  return domain;
}
