import { describe, expect, it, vi } from "vitest";
import {
  DINGTALK_ROBOT_DEFAULT_CONFIG,
} from "@achord/plugin-dingtalk-robot/config";
import {
  configsMatch,
  getRegisteredPlugin,
  listRegisteredPlugins,
  normalizeRegisteredPluginConfig,
  registeredPluginHealthConfig,
  tryParseRegisteredPluginConfig,
  tryParseRegisteredPluginSecretConfig,
} from "@/modules/plugins/plugin-registry";

describe("插件注册白名单", () => {
  it("只暴露显式注册的可信插件", () => {
    expect(listRegisteredPlugins().map((plugin) => plugin.key)).toEqual([
      "content-contact-risk",
      "dingtalk-robot",
      "image-webp",
      "sub2api-connector",
      "universal-embed-connector",
    ]);
  });

  it("拒绝未注册插件", () => {
    expect(() => getRegisteredPlugin("uploaded-arbitrary-code")).toThrow(
      "插件不存在",
    );
  });

  it("钉钉 Webhook 只通过敏感配置解析，不进入普通配置", () => {
    const webhookUrl =
      "https://oapi.dingtalk.com/robot/send?access_token=test-token";
    expect(
      tryParseRegisteredPluginSecretConfig("dingtalk-robot", { webhookUrl }),
    ).toEqual({ ok: true, config: { webhookUrl } });
    expect(
      normalizeRegisteredPluginConfig("dingtalk-robot", { webhookUrl }),
    ).toEqual(DINGTALK_ROBOT_DEFAULT_CONFIG);
  });

  it("钉钉敏感配置拒绝非官方或缺少令牌的地址", () => {
    expect(
      tryParseRegisteredPluginSecretConfig("dingtalk-robot", {
        webhookUrl: "https://example.com/robot/send?access_token=test-token",
      }).ok,
    ).toBe(false);
    expect(
      tryParseRegisteredPluginSecretConfig("dingtalk-robot", {}),
    ).toMatchObject({ ok: false });
  });

  it("钉钉普通配置损坏时也绝不回显历史 Webhook", () => {
    const displayed = normalizeRegisteredPluginConfig("dingtalk-robot", {
      webhookUrl:
        "https://oapi.dingtalk.com/robot/send?access_token=must-not-leak",
      templates: { REQUEST_CREATED: "broken" },
    });
    expect(displayed).not.toHaveProperty("webhookUrl");
    expect(JSON.stringify(displayed)).not.toContain("must-not-leak");
  });

  it("钉钉运行环境检测不发送消息或访问网络", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const plugin = getRegisteredPlugin("dingtalk-robot");

    const result = await plugin.healthCheck?.({
      config: {},
      secrets: {
        webhookUrl:
          "https://oapi.dingtalk.com/robot/send?access_token=test-token",
      },
    });

    expect(result).toMatchObject({ runtime: "ready" });
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("修改钉钉消息模板不会让已验证的 Webhook 健康结果失效", () => {
    const changed = structuredClone(DINGTALK_ROBOT_DEFAULT_CONFIG);
    changed.templates.REQUEST_CREATED.title = "自定义标题";
    expect(
      registeredPluginHealthConfig("dingtalk-robot", changed),
    ).toEqual({});
    expect(
      registeredPluginHealthConfig(
        "dingtalk-robot",
        DINGTALK_ROBOT_DEFAULT_CONFIG,
      ),
    ).toEqual({});
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
