import { describe, expect, it } from "vitest";
import {
  buildAttachmentOnlyMessage,
  buildMessagePreview,
  escapeHtmlText,
  truncatePlainText,
} from "@/lib/message-content";

describe("请求消息摘要", () => {
  it("将富文本转换为紧凑的真实通知摘要", () => {
    expect(
      buildMessagePreview(
        "<p>第一段内容</p><p>第二段内容，包含 <strong>重点</strong></p>",
      ),
    ).toBe("第一段内容 第二段内容，包含 重点");
  });

  it("按字符数截断长引用", () => {
    expect(truncatePlainText("1234567890", 6)).toBe("12345…");
  });

  it("附件占位内容会转义文件名", () => {
    expect(buildAttachmentOnlyMessage(['a<script>.txt', "截图.png"])).toBe(
      "<p>附件：a&lt;script&gt;.txt、截图.png</p>",
    );
  });

  it("标题转义不会生成可执行 HTML", () => {
    expect(escapeHtmlText('<img src=x onerror="x">')).toBe(
      "&lt;img src=x onerror=&quot;x&quot;&gt;",
    );
  });
});
