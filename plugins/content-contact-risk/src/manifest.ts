import type { PlatformPluginManifest } from "@achord/platform-plugin-sdk";
import {
  CONTENT_CONTACT_RISK_DEFAULT_CONFIG,
  CONTENT_CONTACT_RISK_PLUGIN_KEY,
  type ContentContactRiskConfig,
} from "./config";

export const contentContactRiskManifest: PlatformPluginManifest<ContentContactRiskConfig> = {
  key: CONTENT_CONTACT_RISK_PLUGIN_KEY,
  kind: "UTILITY",
  name: "联系方式与站外交易风控",
  description:
    "检查客户可见内容中的联系方式、私下沟通和站外交易引导，支持发送后异步复查、撤回与管理员审计。",
  version: "0.1.0",
  category: "内容风控",
  minimumPlatformVersion: "0.1.0",
  capabilities: [
    "content:moderate",
    "network:ai-provider",
    "jobs:enqueue",
    "events:publish",
  ],
  defaultConfig: CONTENT_CONTACT_RISK_DEFAULT_CONFIG,
  settings: [
    {
      key: "baseUrl",
      type: "url",
      label: "模型 Base URL",
      description: "使用你配置的上游地址，系统不会写死 OpenAI 官方地址。",
      required: true,
      placeholder: "https://api.example.com",
    },
    {
      key: "apiKey",
      type: "secret-text",
      label: "API Key",
      description: "密钥仅在服务端加密保存和使用。",
      required: true,
    },
    {
      key: "model",
      type: "dynamic-select",
      label: "检测模型",
      description: "从上游 /v1/models 获取后选择。",
      required: true,
      actionKey: "discover-models",
    },
    {
      key: "fullAuditEnabled",
      type: "boolean",
      label: "开启后新内容全量复查",
      description: "仅复查本次启用之后的新建或新编辑内容，不检查历史数据。",
    },
  ],
};

export { CONTENT_CONTACT_RISK_PLUGIN_KEY } from "./config";
