import type { PlatformPluginManifest } from "@achord/platform-plugin-sdk";
import {
  IMAGE_WEBP_PLUGIN_KEY,
  imageWebpManifest,
  parseImageWebpConfig,
} from "@achord/plugin-image-webp";
import {
  SUB2API_CONNECTOR_PLUGIN_KEY,
  parseSub2ApiConnectorConfig,
  sub2ApiConnectorManifest,
} from "@achord/plugin-sub2api-connector";
import { DomainError } from "@/modules/projects/errors";

export type RegisteredPlugin = {
  manifest: PlatformPluginManifest<Record<string, unknown>>;
  parseConfig: (value: unknown) => Record<string, unknown>;
  healthCheck?: () =>
    | Promise<Record<string, string>>
    | Record<string, string>;
};

const registeredPlugins: readonly RegisteredPlugin[] = [
  {
    manifest:
      imageWebpManifest as PlatformPluginManifest<Record<string, unknown>>,
    parseConfig: (value) => parseImageWebpConfig(value),
    healthCheck: async () => {
      const { getImageWebpRuntimeHealth } = await import(
        "@achord/plugin-image-webp/runtime"
      );
      return getImageWebpRuntimeHealth();
    },
  },
  {
    manifest:
      sub2ApiConnectorManifest as PlatformPluginManifest<
        Record<string, unknown>
      >,
    parseConfig: (value) => parseSub2ApiConnectorConfig(value),
    healthCheck: async () => {
      const { getSub2ApiConnectorRuntimeHealth } = await import(
        "@achord/plugin-sub2api-connector/runtime"
      );
      return getSub2ApiConnectorRuntimeHealth();
    },
  },
];

export { IMAGE_WEBP_PLUGIN_KEY, SUB2API_CONNECTOR_PLUGIN_KEY };

export function listRegisteredPlugins() {
  return registeredPlugins.map((plugin) => plugin.manifest);
}

export function getRegisteredPlugin(pluginKey: string) {
  const plugin = registeredPlugins.find(
    (item) => item.manifest.key === pluginKey,
  );
  if (!plugin) {
    throw new DomainError("PLUGIN_NOT_FOUND", "插件不存在", 404);
  }
  return plugin;
}
