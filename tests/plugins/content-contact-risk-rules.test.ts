import { describe, expect, it } from "vitest";
import {
  evaluateContactRiskRules,
  normalizeRiskText,
} from "../../plugins/content-contact-risk/src/rules";

describe("联系方式固定规则", () => {
  it("清理 Unicode 兼容字符和零宽字符", () => {
    expect(normalizeRiskText("微\u200b信：ＡＢＣ１２３")).toBe("微信:ABC123");
  });

  it("保留 HTML 属性中的链接并解码数字实体", () => {
    const result = evaluateContactRiskRules(
      '<a href="mailto:test&#64;outside.example">资料</a>',
    );
    expect(result.blocked).toBe(true);
    expect(result.categories).toContain("EMAIL_ADDRESS");
  });

  it.each([
    ["手机号 138 0013 8000", "PHONE_NUMBER"],
    ["邮箱 test@example.com", "EMAIL_ADDRESS"],
    ["微信号: contact_me", "SOCIAL_ACCOUNT"],
    ["加。我。vx123324212", "SOCIAL_ACCOUNT"],
    ["加个微信", "OFF_PLATFORM_GUIDANCE"],
  ])("明确联系方式立即阻止：%s", (text, category) => {
    const result = evaluateContactRiskRules(text);
    expect(result.blocked).toBe(true);
    expect(result.categories).toContain(category);
  });

  it("允许域名白名单不触发邮箱和链接风险", () => {
    const result = evaluateContactRiskRules(
      "请查看 https://docs.achord.cn，并发到 team@achord.cn",
      { allowedDomains: ["achord.cn"] },
    );
    expect(result.blocked).toBe(false);
    expect(result.candidate).toBe(false);
  });

  it.each([
    "我们私聊处理",
    "访问 https://outside.example.com",
    "扣 扣 号稍后发你",
    "一三八 零零一三 八零零零",
  ])("高风险暗语进入模型候选：%s", (text) => {
    const result = evaluateContactRiskRules(text);
    expect(result.candidate).toBe(true);
  });

  it("普通业务内容直接放行", () => {
    expect(
      evaluateContactRiskRules("项目已完成部署，请在平台内确认验收"),
    ).toMatchObject({ blocked: false, candidate: false, categories: [] });
  });
});
