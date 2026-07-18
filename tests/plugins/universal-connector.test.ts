import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  parseUniversalEmbedConnectorConfig,
  universalEmbedConnectorManifest,
} from "@achord/plugin-universal-embed-connector";
import {
  normalizeEmbedOrigin,
  normalizeWebhookUrl,
} from "@/modules/integrations/external/network-security";
import {
  normalizeUniversalProfileFields,
  validateUniversalProfileAttributes,
} from "@/modules/integrations/universal/profile";
import {
  createUniversalCredential,
  createUniversalTicket,
  verifyUniversalSecret,
} from "@/modules/integrations/universal/security";
import {
  universalConnectionSchema,
  universalExchangeSchema,
  universalLaunchTicketSchema,
} from "@/modules/integrations/universal/schemas";
import {
  createUniversalWebhookSignature,
  verifyUniversalWebhookSignature,
} from "@/modules/integrations/universal/webhook-signature";

describe("Achord Connect v1", () => {
  it("以默认关闭的外部连接器清单注册", () => {
    expect(universalEmbedConnectorManifest.key).toBe(
      "universal-embed-connector",
    );
    expect(universalEmbedConnectorManifest.kind).toBe("EXTERNAL_CONNECTOR");
    expect(universalEmbedConnectorManifest.capabilities).toEqual(
      expect.arrayContaining([
        "launch-ticket:issue",
        "embed-session:issue",
        "webhook:deliver",
        "network:webhook",
      ]),
    );
    expect(parseUniversalEmbedConnectorConfig({})).toEqual({});
  });

  it("生成高熵凭据和单次票据并使用常量时间摘要验证", () => {
    const credential = createUniversalCredential();
    const ticket = createUniversalTicket();
    expect(credential.clientId).toMatch(/^ac_/);
    expect(credential.clientSecret).toMatch(/^acs_/);
    expect(ticket.ticket).toMatch(/^act_/);
    expect(
      verifyUniversalSecret(
        credential.clientSecret,
        credential.secretHash,
      ),
    ).toBe(true);
    expect(
      verifyUniversalSecret("acs_wrong", credential.secretHash),
    ).toBe(false);
  });

  it("严格校验 Origin、Webhook 地址和连接字段上限", () => {
    expect(normalizeEmbedOrigin("https://app.example.com")).toBe(
      "https://app.example.com",
    );
    expect(normalizeWebhookUrl("https://app.example.com/achord/webhook")).toBe(
      "https://app.example.com/achord/webhook",
    );
    expect(() => normalizeEmbedOrigin("https://app.example.com/path")).toThrow(
      "Origin 只能包含",
    );
    expect(() =>
      universalConnectionSchema.parse({
        name: "连接",
        allowedOrigins: ["https://app.example.com"],
        profileFields: Array.from({ length: 11 }, (_, index) => ({
          key: `field_${index}`,
          label: `字段 ${index}`,
          type: "text",
        })),
      }),
    ).toThrow();
  });

  it("拒绝保留字段、重复字段、未声明属性和错误类型", () => {
    expect(() =>
      normalizeUniversalProfileFields([
        { key: "email", label: "邮箱", type: "text" },
      ]),
    ).toThrow("保留字段");
    expect(() =>
      normalizeUniversalProfileFields([
        { key: "level", label: "等级", type: "number" },
        { key: "level", label: "等级 2", type: "number" },
      ]),
    ).toThrow("重复");
    const fields = [
      { key: "level", label: "等级", type: "number" as const },
      { key: "joined_at", label: "加入日期", type: "date" as const },
    ];
    expect(
      validateUniversalProfileAttributes(
        { level: 3, joined_at: "2026-07-18" },
        fields,
      ),
    ).toEqual({ level: 3, joined_at: "2026-07-18" });
    expect(() =>
      validateUniversalProfileAttributes({ unknown: true }, fields),
    ).toThrow("未在连接中声明");
    expect(() =>
      validateUniversalProfileAttributes({ level: "3" }, fields),
    ).toThrow("类型不正确");
  });

  it("按共享测试向量生成一致的 Webhook 签名", () => {
    const vector = JSON.parse(
      readFileSync(
        resolve(
          process.cwd(),
          "examples/integrations/shared/webhook-test-vectors.json",
        ),
        "utf8",
      ),
    ) as {
      secret: string;
      timestamp: string;
      rawBody: string;
      signature: string;
    };
    expect(
      createUniversalWebhookSignature(
        vector.secret,
        vector.timestamp,
        vector.rawBody,
      ),
    ).toBe(vector.signature);
    expect(
      verifyUniversalWebhookSignature({
        ...vector,
        signature: `v1=${vector.signature}`,
      }),
    ).toBe(true);
    expect(
      verifyUniversalWebhookSignature({
        ...vector,
        rawBody: `${vector.rawBody} `,
        signature: `v1=${vector.signature}`,
      }),
    ).toBe(false);
  });

  it("只接受字符串外部用户 ID，并保持相邻 64 位 ID 的唯一性", () => {
    const first = universalLaunchTicketSchema.parse({
      user: {
        id: "9223372036854775807",
        name: "外部用户",
        attributes: { level: 3 },
      },
    });
    const second = universalLaunchTicketSchema.parse({
      user: {
        id: "9223372036854775806",
        name: "外部用户",
      },
    });
    expect(first.user.id).toBe("9223372036854775807");
    expect(second.user.id).toBe("9223372036854775806");
    expect(first.user.id).not.toBe(second.user.id);
    expect(() =>
      universalLaunchTicketSchema.parse({
        user: { id: 42, name: "外部用户" },
      }),
    ).toThrow();
  });

  it("Universal 票据兑换必须提交父页面 Origin", () => {
    expect(() =>
      universalExchangeSchema.parse({
        publicId: "public-id",
        ticket: "act_1234567890123456",
      }),
    ).toThrow();
    expect(
      universalExchangeSchema.parse({
        publicId: "public-id",
        ticket: "act_1234567890123456",
        parentOrigin: "https://app.example.test",
      }).parentOrigin,
    ).toBe("https://app.example.test");
  });

  it("限制外部用户资料值", () => {
    expect(() =>
      universalLaunchTicketSchema.parse({
        user: {
          id: "u",
          name: "外部用户",
          attributes: { note: "x".repeat(501) },
        },
      }),
    ).toThrow();
  });
});
