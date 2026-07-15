import { describe, expect, it } from "vitest";
import {
  getMailTemplateDefinition,
  normalizeMailActionUrl,
  renderTemplateContent,
  sampleVariablesForTemplate,
  validateTemplatePlaceholders,
} from "../../src/modules/platform-settings/mail-template-catalog";

describe("mail template catalog", () => {
  it("renders allowed variables in every field", () => {
    const definition = getMailTemplateDefinition("STAFF_INVITATION");
    const rendered = renderTemplateContent(
      definition.key,
      definition.defaults,
      { roleGroupName: "技术支持" },
    );

    expect(rendered.subject).toContain("技术支持");
    expect(rendered.body).toContain("技术支持");
    expect(rendered.subject).not.toContain("{{");
  });

  it("rejects variables outside the template whitelist", () => {
    const defaults = getMailTemplateDefinition("TEST_EMAIL").defaults;
    expect(() =>
      validateTemplatePlaceholders("TEST_EMAIL", {
        ...defaults,
        subject: "测试 {{unsafeHtml}}",
      }),
    ).toThrow("不可用于此模板");
  });

  it("requires values for placeholders used by the template", () => {
    const definition = getMailTemplateDefinition("PASSWORD_RESET");
    expect(() =>
      renderTemplateContent(definition.key, definition.defaults, {}),
    ).toThrow("缺少变量");
  });

  it("provides complete sample variables for previews", () => {
    const definition = getMailTemplateDefinition(
      "CUSTOMER_OWNER_INVITATION",
    );
    const rendered = renderTemplateContent(
      definition.key,
      definition.defaults,
      sampleVariablesForTemplate(definition.key),
    );
    expect(rendered.subject).toContain("示例客户");
  });

  it("only accepts HTTP and HTTPS action links", () => {
    expect(normalizeMailActionUrl("https://support.achord.cn/login")).toBe(
      "https://support.achord.cn/login",
    );
    expect(() => normalizeMailActionUrl("javascript:alert(1)")).toThrow(
      "仅支持 HTTP 或 HTTPS",
    );
  });
});
