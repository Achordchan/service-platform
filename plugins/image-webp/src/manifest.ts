import type { PlatformPluginManifest } from "@achord/platform-plugin-sdk";
import { z } from "zod";

export const IMAGE_WEBP_PLUGIN_KEY = "image-webp";

export const imageWebpConfigSchema = z.object({
  quality: z.number().int().min(60).max(95).default(82),
  effort: z.number().int().min(0).max(4).default(2),
  maxInputMegapixels: z.number().int().min(5).max(100).default(40),
  minimumSavingsPercent: z.number().int().min(1).max(50).default(5),
});

export type ImageWebpConfig = z.infer<typeof imageWebpConfigSchema>;

export const imageWebpManifest: PlatformPluginManifest<ImageWebpConfig> = {
  key: IMAGE_WEBP_PLUGIN_KEY,
  kind: "UTILITY",
  name: "图片 WebP 优化",
  description: "在后台将 JPEG、PNG 附件转换为体积更小的 WebP 文件。",
  version: "1.0.2",
  category: "存储与附件",
  minimumPlatformVersion: "0.1.0",
  capabilities: [
    "attachment:read",
    "attachment:transform",
    "jobs:enqueue",
    "events:publish",
  ],
  defaultConfig: imageWebpConfigSchema.parse({}),
  settings: [
    {
      key: "quality",
      type: "number",
      label: "WebP 质量",
      description: "数值越高画质越好、文件通常越大。",
      min: 60,
      max: 95,
    },
    {
      key: "effort",
      type: "number",
      label: "压缩强度",
      description: "数值越高越耗 CPU；生产 VPS 建议保持 2。",
      min: 0,
      max: 4,
    },
    {
      key: "maxInputMegapixels",
      type: "number",
      label: "最大输入像素（百万）",
      description: "超过限制的图片保留原文件，防止异常图片占用过多内存。",
      min: 5,
      max: 100,
    },
    {
      key: "minimumSavingsPercent",
      type: "number",
      label: "最小节省比例",
      description: "转换结果达到该节省比例后才替换原文件。",
      min: 1,
      max: 50,
    },
  ],
  actions: [
    {
      key: "migrate-history",
      label: "迁移历史图片",
      description: "限速扫描并优化已有 JPEG、PNG 附件。",
      destructive: true,
    },
  ],
};

export function parseImageWebpConfig(value: unknown) {
  return imageWebpConfigSchema.parse(value);
}
