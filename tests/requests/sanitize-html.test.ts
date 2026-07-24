import { describe, expect, it } from "vitest";
import { hasMeaningfulHtml } from "../../src/lib/message-content";
import {
  sanitizeMessageHtml,
  sanitizeReeditableMessageHtml,
} from "../../src/lib/sanitize-html";

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
    expect(
      hasMeaningfulHtml(
        '<img src="attachment://cmriy2wf0000hdn5ughz329jp" data-attachment-id="cmriy2wf0000hdn5ughz329jp">',
      ),
    ).toBe(true);
  });

  it("只保留受控附件图片并移除外部图片地址", () => {
    const html = sanitizeMessageHtml(
      '<p>截图</p><img src="attachment://cmriy2wf0000hdn5ughz329jp" data-attachment-id="cmriy2wf0000hdn5ughz329jp" alt="测试截图"><img src="https://tracker.example/pixel.png">',
    );
    expect(html).toContain(
      'src="attachment://cmriy2wf0000hdn5ughz329jp"',
    );
    expect(html).toContain(
      'data-attachment-id="cmriy2wf0000hdn5ughz329jp"',
    );
    expect(html).not.toContain("tracker.example");
  });

  it("恢复撤回草稿时保留排版但移除旧内联图片", () => {
    const html = sanitizeReeditableMessageHtml(
      '<p><strong>重要说明</strong></p><img src="attachment://image-1" data-attachment-id="image-1"><ul><li>第一项</li></ul>',
    );
    expect(html).toContain("<strong>重要说明</strong>");
    expect(html).toContain("<li>第一项</li>");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("attachment://image-1");
  });
});
