import { describe, expect, it } from "vitest";
import {
  ATTACHMENT_NOTE_MAX_LENGTH,
  ATTACHMENT_TITLE_MAX_LENGTH,
  attachmentRiskText,
  normalizeAttachmentNote,
  normalizeAttachmentTitle,
} from "@/modules/attachments/attachment-meta";

describe("normalizeAttachmentTitle", () => {
  it("空值与空白返回 null（展示端兜底 originalName）", () => {
    expect(normalizeAttachmentTitle(undefined)).toBeNull();
    expect(normalizeAttachmentTitle("")).toBeNull();
    expect(normalizeAttachmentTitle("   ")).toBeNull();
  });

  it("剔除控制字符并裁剪长度", () => {
    expect(normalizeAttachmentTitle(`  验收报告${String.fromCharCode(0)}v2  `)).toBe(
      "验收报告v2",
    );
    const long = "标".repeat(ATTACHMENT_TITLE_MAX_LENGTH + 10);
    expect(normalizeAttachmentTitle(long)).toHaveLength(
      ATTACHMENT_TITLE_MAX_LENGTH,
    );
  });
});

describe("normalizeAttachmentNote", () => {
  it("保留换行、剔除其他控制字符、裁剪长度", () => {
    expect(normalizeAttachmentNote(`第一行\n第二行${String.fromCharCode(7)}`)).toBe(
      "第一行\n第二行",
    );
    expect(normalizeAttachmentNote("  ")).toBeNull();
    const long = "备".repeat(ATTACHMENT_NOTE_MAX_LENGTH + 10);
    expect(normalizeAttachmentNote(long)).toHaveLength(
      ATTACHMENT_NOTE_MAX_LENGTH,
    );
  });
});

describe("attachmentRiskText", () => {
  it("拼装文件名、标题、备注供内容风控扫描", () => {
    expect(attachmentRiskText("a.pdf", "标题", "备注")).toBe(
      "a.pdf\n标题\n备注",
    );
    expect(attachmentRiskText("a.pdf", null, null)).toBe("a.pdf");
  });
});
