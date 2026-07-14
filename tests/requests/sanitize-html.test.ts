import { describe, expect, it } from "vitest";
import { hasMeaningfulHtml } from "../../src/lib/message-content";
import { sanitizeMessageHtml } from "../../src/lib/sanitize-html";

describe("消息富文本消毒", () => {
  it("保留基础排版并移除脚本", () => {
    const html = sanitizeMessageHtml(
      '<p>你好</p><script>alert(1)</script><a href="javascript:alert(1)">x</a><a href="https://example.com">ok</a>',
    );
    expect(html).toContain("<p>你好</p>");
    expect(html).not.toContain("script");
    expect(html).toContain('href="https://example.com"');
    expect(html).not.toContain("javascript:");
  });

  it("识别空内容", () => {
    expect(hasMeaningfulHtml("<p><br></p>")).toBe(false);
    expect(hasMeaningfulHtml("<p>内容</p>")).toBe(true);
  });
});
