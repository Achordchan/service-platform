export type PluginCapability =
  | "attachment:read"
  | "attachment:transform"
  | "jobs:enqueue"
  | "events:publish"
  | "project:bind"
  | "external-identity:verify"
  | "network:sub2api"
  | "embed-session:issue"
  | "mail:enqueue";

export type PluginSettingField =
  | {
      key: string;
      type: "number";
      label: string;
      description: string;
      min: number;
      max: number;
      step?: number;
    }
  | {
      key: string;
      type: "boolean";
      label: string;
      description: string;
    };

export type PlatformPluginManifest<TConfig extends Record<string, unknown>> = {
  key: string;
  name: string;
  description: string;
  version: string;
  category: string;
  minimumPlatformVersion: string;
  capabilities: PluginCapability[];
  defaultConfig: TConfig;
  settings: PluginSettingField[];
  actions?: Array<{
    key: string;
    label: string;
    description: string;
    destructive?: boolean;
  }>;
};

export type BinaryTransformInput<TConfig extends Record<string, unknown>> = {
  buffer: Uint8Array;
  mimeType: string;
  config: TConfig;
};

export type BinaryTransformResult =
  | {
      status: "TRANSFORMED";
      buffer: Uint8Array;
      mimeType: string;
      extension: string;
      width: number;
      height: number;
    }
  | {
      status: "SKIPPED";
      reason: string;
    };
