import type { PlatformPluginManifest } from "@achord/platform-plugin-sdk";
import {
  IMAGE_WEBP_PLUGIN_KEY,
  imageWebpManifest,
  parseImageWebpConfig,
} from "@achord/plugin-image-webp";
import { DomainError } from "@/modules/projects/errors";

export type RegisteredPlugin = {
  manifest: PlatformPluginManifest<Record<string, unknown>>;
  parseConfig: (value: unknown) => Record<string, unknown>;
};

const registeredPlugins: readonly RegisteredPlugin[] = [
  {
    manifest:
      imageWebpManifest as PlatformPluginManifest<Record<string, unknown>>,
    parseConfig: (value) => parseImageWebpConfig(value),
  },
];

export { IMAGE_WEBP_PLUGIN_KEY };

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
