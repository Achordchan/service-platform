import type { PlatformPluginManifest } from "@achord/platform-plugin-sdk";
import { z } from "zod";

export const SUB2API_CONNECTOR_PLUGIN_KEY = "sub2api-connector";

export const sub2ApiConnectorConfigSchema = z.object({});
export type Sub2ApiConnectorConfig = z.infer<
  typeof sub2ApiConnectorConfigSchema
>;

export const sub2ApiConnectorManifest: PlatformPluginManifest<Sub2ApiConnectorConfig> = {
  key: SUB2API_CONNECTOR_PLUGIN_KEY,
  kind: "EXTERNAL_CONNECTOR",
  name: "Sub2API 工单连接器",
  description: "将 Sub2API 登录用户安全映射为项目外部联系人并提供独立工单门户。",
  version: "1.0.0",
  category: "外部接入",
  minimumPlatformVersion: "0.1.0",
  capabilities: [
    "project:bind",
    "external-identity:verify",
    "network:sub2api",
    "embed-session:issue",
    "events:publish",
    "mail:enqueue",
  ],
  defaultConfig: {},
  settings: [],
};

export function parseSub2ApiConnectorConfig(value: unknown) {
  return sub2ApiConnectorConfigSchema.parse(value ?? {});
}
