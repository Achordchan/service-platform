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
import {
  UNIVERSAL_EMBED_CONNECTOR_PLUGIN_KEY,
  parseUniversalEmbedConnectorConfig,
  universalEmbedConnectorManifest,
} from "@achord/plugin-universal-embed-connector";
import { DomainError } from "@/modules/projects/errors";


function stableSerialize(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableSerialize(record[key])}`)
    .join(",")}}`;
}

/** Structural equality that ignores object key order (PostgreSQL jsonb may reorder keys). */
export function configsMatch(left: unknown, right: unknown) {
  return stableSerialize(left) === stableSerialize(right);
}

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
  {
    manifest:
      universalEmbedConnectorManifest as PlatformPluginManifest<
        Record<string, unknown>
      >,
    parseConfig: (value) => parseUniversalEmbedConnectorConfig(value),
    healthCheck: async () => {
      const { getUniversalEmbedConnectorRuntimeHealth } = await import(
        "@achord/plugin-universal-embed-connector/runtime"
      );
      return getUniversalEmbedConnectorRuntimeHealth();
    },
  },
];

export {
  IMAGE_WEBP_PLUGIN_KEY,
  SUB2API_CONNECTOR_PLUGIN_KEY,
  UNIVERSAL_EMBED_CONNECTOR_PLUGIN_KEY,
};

export function listRegisteredPlugins() {
  return registeredPlugins.map((plugin) => plugin.manifest);
}

export function listRegisteredExternalConnectors() {
  return registeredPlugins
    .map((plugin) => plugin.manifest)
    .filter((manifest) => manifest.kind === "EXTERNAL_CONNECTOR");
}

export type PluginConfigParseResult =
  | { ok: true; config: Record<string, unknown> }
  | { ok: false; error: string };

export function tryParseRegisteredPluginConfig(
  pluginKey: string,
  value: unknown,
): PluginConfigParseResult {
  const plugin = getRegisteredPlugin(pluginKey);
  try {
    return { ok: true, config: plugin.parseConfig(value) };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "插件配置无效",
    };
  }
}

/** Parse config for display. Invalid configs keep raw values and never fall back to defaults. */
export function normalizeRegisteredPluginConfig(
  pluginKey: string,
  value: unknown,
) {
  const parsed = tryParseRegisteredPluginConfig(pluginKey, value);
  if (parsed.ok) return parsed.config;
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
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
