import type { PlatformPluginManifest } from "@achord/platform-plugin-sdk";
import { z } from "zod";

export const UNIVERSAL_EMBED_CONNECTOR_PLUGIN_KEY =
  "universal-embed-connector";

export const universalEmbedConnectorConfigSchema = z.object({});
export type UniversalEmbedConnectorConfig = z.infer<
  typeof universalEmbedConnectorConfigSchema
>;

export const universalEmbedConnectorManifest: PlatformPluginManifest<UniversalEmbedConnectorConfig> = {
  key: UNIVERSAL_EMBED_CONNECTOR_PLUGIN_KEY,
  kind: "EXTERNAL_CONNECTOR",
  name: "通用服务请求连接器",
  description: "通过 Achord Connect v1 将第三方产品的已登录用户安全接入独立服务请求门户。",
  version: "1.0.0",
  category: "外部接入",
  minimumPlatformVersion: "0.1.0",
  capabilities: [
    "project:bind",
    "external-identity:verify",
    "launch-ticket:issue",
    "embed-session:issue",
    "events:publish",
    "webhook:deliver",
    "network:webhook",
    "mail:enqueue",
  ],
  defaultConfig: {},
  settings: [],
};

export function parseUniversalEmbedConnectorConfig(value: unknown) {
  return universalEmbedConnectorConfigSchema.parse(value ?? {});
}
