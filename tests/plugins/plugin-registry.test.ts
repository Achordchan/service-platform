import { describe, expect, it } from "vitest";
import {
  configsMatch,
  getRegisteredPlugin,
  listRegisteredPlugins,
  normalizeRegisteredPluginConfig,
  tryParseRegisteredPluginConfig,
} from "@/modules/plugins/plugin-registry";

describe("插件注册白名单", () => {
  it("只暴露显式注册的可信插件", () => {
    expect(listRegisteredPlugins().map((plugin) => plugin.key)).toEqual([
      "image-webp",
      "sub2api-connector",
    ]);
  });

  it("拒绝未注册插件", () => {
    expect(() => getRegisteredPlugin("uploaded-arbitrary-code")).toThrow(
      "插件不存在",
    );
  });

  it("按插件 schema 隔离配置并移除其他插件字段", () => {
    expect(
      normalizeRegisteredPluginConfig("sub2api-connector", {
        quality: 82,
        effort: 2,
        maxInputMegapixels: 40,
        minimumSavingsPercent: 5,
      }),
    ).toEqual({});
    expect(normalizeRegisteredPluginConfig("image-webp", {})).toEqual({
      quality: 82,
      effort: 2,
      maxInputMegapixels: 40,
      minimumSavingsPercent: 5,
    });
  });

  it("非法配置解析失败且不回落到默认配置", () => {
    const invalid = {
      quality: "bad",
      effort: 2,
      maxInputMegapixels: 40,
      minimumSavingsPercent: 5,
    };
    const parsed = tryParseRegisteredPluginConfig("image-webp", invalid);
    expect(parsed.ok).toBe(false);
    expect(normalizeRegisteredPluginConfig("image-webp", invalid)).toEqual(
      invalid,
    );
  });

  it("配置比较忽略对象键顺序", () => {
    expect(
      configsMatch(
        { quality: 82, effort: 2, maxInputMegapixels: 40, minimumSavingsPercent: 5 },
        { minimumSavingsPercent: 5, maxInputMegapixels: 40, effort: 2, quality: 82 },
      ),
    ).toBe(true);
    expect(
      configsMatch(
        { quality: 82, effort: 2, maxInputMegapixels: 40, minimumSavingsPercent: 5 },
        { quality: 80, effort: 2, maxInputMegapixels: 40, minimumSavingsPercent: 5 },
      ),
    ).toBe(false);
  });
});
