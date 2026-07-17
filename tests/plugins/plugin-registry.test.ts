import { describe, expect, it } from "vitest";
import {
  getRegisteredPlugin,
  listRegisteredPlugins,
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
});
