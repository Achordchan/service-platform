export type PlatformPluginManifest = {
  key: string;
  name: string;
  description: string;
  version: string;
  category: string;
  enabled: boolean;
  settingsHref?: string;
};

const pluginRegistry: readonly PlatformPluginManifest[] = [];

export function listRegisteredPlugins(): PlatformPluginManifest[] {
  return pluginRegistry.map((plugin) => ({ ...plugin }));
}
