import { describe, expect, it } from "vitest";
import {
  getMailTemplateDefinition,
  normalizeMailActionUrl,
  renderTemplateContent,
  sampleVariablesForTemplate,
  validateTemplatePlaceholders,
} from "../../src/modules/platform-settings/mail-template-catalog";

describe("mail template catalog", () => {
  it("renders a dedicated staff email for customer-created requests", () => {
    const definition = getMailTemplateDefinition(
      "STANDARD_REQUEST_STAFF_CREATED",
    );
    const rendered = renderTemplateContent(
      definition.key,
      definition.defaults,
      sampleVariablesForTemplate(definition.key),
    );

    expect(rendered.subject).toBe(
      "网站 SEO 项目 收到新服务请求 SR-20260721-001",
    );
    expect(rendered.previewText).toBe(
      "张三 提交了“网站优化进度咨询”",
    );
    expect(rendered.body).toContain(
      "你负责或参与管理的项目“网站 SEO 项目”",
    );
    expect(rendered.body).toContain("提交人：张三");
    expect(rendered.body).toContain("服务请求编号：SR-20260721-001");
    expect(rendered.body).toContain("问题摘要：想确认当前优化工作");
    expect(rendered.actionLabel).toBe("查看并处理");
  });

  it("renders the platform-admin request-claimed email", () => {
    const definition = getMailTemplateDefinition(
      "STANDARD_REQUEST_STAFF_CLAIMED",
    );
    const rendered = renderTemplateContent(
      definition.key,
      definition.defaults,
      sampleVariablesForTemplate(definition.key),
    );

    expect(rendered.subject).toContain("已有项目人员接手");
    expect(rendered.previewText).toContain("金晶已接手服务请求");
    expect(rendered.body).toContain("服务请求已有项目人员接手");
    expect(rendered.actionLabel).toBe("查看服务请求");
  });

  it("renders the project-created template", () => {
    const definition = getMailTemplateDefinition("STANDARD_PROJECT_CREATED");
    const rendered = renderTemplateContent(
      definition.key,
      definition.defaults,
      sampleVariablesForTemplate(definition.key),
    );

    expect(rendered.subject).toContain("官网升级项目");
    expect(rendered.body).toContain("已创建并与你关联");
    expect(rendered.actionLabel).toBe("查看项目");
  });

  it("renders the login email OTP template without an action link", () => {
    const definition = getMailTemplateDefinition("LOGIN_EMAIL_OTP");
    const rendered = renderTemplateContent(
      definition.key,
      definition.defaults,
      sampleVariablesForTemplate(definition.key),
    );

    expect(rendered.subject).toContain("382941");
    expect(rendered.body).toContain("5 分钟");
    expect(rendered.actionLabel).toBeNull();
  });

  it("renders personalized staff invitation variables", () => {
    const definition = getMailTemplateDefinition("STAFF_INVITATION");
    const rendered = renderTemplateContent(
      definition.key,
      definition.defaults,
      sampleVariablesForTemplate(definition.key),
    );

    expect(rendered.subject).toContain("李明");
    expect(rendered.previewText).toContain("王经理");
    expect(rendered.body).toContain("项目负责人");
    expect(rendered.body).toContain("24 小时");
    expect(rendered.subject).not.toContain("{{");
  });

  it("allows optional staff profile variables to be empty", () => {
    const definition = getMailTemplateDefinition("STAFF_INVITATION");
    const variables = sampleVariablesForTemplate(definition.key);
    const rendered = renderTemplateContent(
      definition.key,
      {
        ...definition.defaults,
        body: "{{recipientName}} / {{company}} / {{jobTitle}} / {{contactNotes}}",
      },
      {
        ...variables,
        company: "",
        jobTitle: "",
        contactNotes: "",
      },
    );

    expect(rendered.body).toBe("李明 /  /  / ");
  });

  it("renders customer owner identity and customer name", () => {
    const definition = getMailTemplateDefinition(
      "CUSTOMER_OWNER_INVITATION",
    );
    const rendered = renderTemplateContent(
      definition.key,
      definition.defaults,
      sampleVariablesForTemplate(definition.key),
    );

    expect(rendered.subject).toContain("陈总");
    expect(rendered.subject).toContain("示例客户");
    expect(rendered.body).toContain("服务支持团队");
  });

  it("keeps the legacy space name variable available", () => {
    const definition = getMailTemplateDefinition(
      "CUSTOMER_MEMBER_INVITATION",
    );
    const rendered = renderTemplateContent(
      definition.key,
      {
        ...definition.defaults,
        body: "加入 {{spaceName}}",
      },
      sampleVariablesForTemplate(definition.key),
    );

    expect(rendered.body).toBe("加入 示例客户");
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
    expect(rendered.subject).toContain("陈总");
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
